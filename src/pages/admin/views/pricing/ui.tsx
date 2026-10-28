import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// Form controls drawn to the Administration tokens (6px input radius, 1px
// #D6DFEA lines, 14px text). Shared by the Pricing & Products views only.

export const inputClass =
  "h-9 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] leading-[20px] text-adm-ink placeholder:text-adm-muted disabled:bg-adm-workspace disabled:text-adm-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary";

export const AdminInput = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(inputClass, className)} {...rest} />;

export const AdminSelect = ({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn(inputClass, "pr-8", className)} {...rest}>
    {children}
  </select>
);

export const Field = ({ label, hint, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) => (
  <div className={className}>
    <label htmlFor={htmlFor} className="block text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">{hint}</p>}
  </div>
);

export const CheckRow = ({
  checked,
  onChange,
  label,
  detail,
  disabled,
  name,
  type = "checkbox",
  size = "md",
  title,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  detail?: ReactNode;
  disabled?: boolean;
  name?: string;
  type?: "checkbox" | "radio";
  /** The reference draws its 07 controls at 22px with 15px labels. */
  size?: "md" | "lg";
  title?: string;
  className?: string;
}) => {
  const lg = size === "lg";
  return (
    <label title={title} className={cn("flex items-start rounded-md", lg ? "gap-3" : "gap-3 px-1 py-1.5", disabled ? "opacity-60" : "cursor-pointer", className)}>
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={cn("accent-adm-primary flex-shrink-0", lg ? "h-[22px] w-[22px] -mt-px" : "mt-[3px] h-4 w-4")}
      />
      <span className="min-w-0">
        <span className={cn("block text-adm-ink", lg ? "text-[15px] leading-[20px]" : "text-[14px] leading-[20px]")}>{label}</span>
        {detail && <span className={cn("block text-adm-muted", lg ? "text-[13px] leading-[18px]" : "text-[12px] leading-[18px]")}>{detail}</span>}
      </span>
    </label>
  );
};
