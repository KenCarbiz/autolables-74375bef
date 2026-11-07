import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminIcon, AdminIconTile, type AdminIconName } from "./AdminIcon";

/** Form column plus an optional sticky preview. Stacks below 1024px; the page owns the only scroller. */
export const EditorLayout = ({ children, preview, previewLabel = "Preview", className }: { children: ReactNode; preview?: ReactNode; previewLabel?: string; className?: string }) => (
  <div className={cn("grid gap-4 lg:gap-6 items-start", preview ? "lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]" : "grid-cols-1", className)}>
    <div className="min-w-0 space-y-4">{children}</div>
    {preview && (
      <aside aria-label={previewLabel} className="min-w-0 lg:sticky lg:top-4 space-y-4">
        {preview}
      </aside>
    )}
  </div>
);

export const SectionCard = ({
  title,
  description,
  icon,
  actions,
  children,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: AdminIconName;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
}) => {
  const auto = useId();
  const headingId = `${id ?? auto}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className={cn("rounded-xl bg-adm-surface border border-adm-divider shadow-[0_1px_2px_rgba(27,43,59,0.06)]", className)}>
      <header className="flex items-start gap-3 sm:gap-4 px-4 sm:px-6 pt-5 pb-4 border-b border-adm-divider">
        {icon && <AdminIconTile name={icon} />}
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-[18px] leading-[26px] font-semibold text-adm-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{description}</p>}
        </div>
        {actions && <div className="flex-shrink-0 flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
      </header>
      {children !== undefined && <div className="px-4 sm:px-6 py-5 space-y-5">{children}</div>}
    </section>
  );
};

export const INPUT_CLASS =
  "w-full min-h-[40px] max-sm:min-h-[44px] rounded-md border border-adm-border bg-adm-surface px-3 py-2 text-[14px] leading-[20px] text-adm-ink placeholder:text-adm-muted disabled:bg-adm-workspace disabled:text-adm-muted disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary aria-[invalid=true]:border-adm-danger";

export const FieldGroup = ({ legend, description, children, className }: { legend: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) => (
  <fieldset className={cn("min-w-0 space-y-4", className)}>
    <legend className="text-[14px] leading-[20px] font-semibold text-adm-ink">{legend}</legend>
    {description && <p className="-mt-2 text-[13px] leading-[18px] text-adm-muted">{description}</p>}
    {children}
  </fieldset>
);

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  required?: boolean;
}

/** One labelled control. The render prop receives the ids a native input needs so the label, help and error stay associated. */
export const FieldRow = ({
  label,
  help,
  error,
  required,
  optional,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  optional?: boolean;
  htmlFor?: string;
  children: ReactNode | ((props: FieldControlProps) => ReactNode);
  className?: string;
}) => {
  const auto = useId();
  const id = htmlFor ?? `${auto}-field`;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-[14px] leading-[20px] font-medium text-adm-ink">
        <span>{label}</span>
        {required && <span className="text-adm-danger" aria-hidden="true">*</span>}
        {required && <span className="sr-only">(required)</span>}
        {optional && !required && <span className="text-[13px] font-normal text-adm-muted">Optional</span>}
      </label>
      <div className="mt-1.5">
        {typeof children === "function"
          ? children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required || undefined })
          : children}
      </div>
      {help && <p id={helpId} className="mt-1.5 text-[13px] leading-[18px] text-adm-muted">{help}</p>}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-[18px] font-medium text-adm-danger">
          <AdminIcon name="alert" size="inline" className="mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

export const AdvancedDisclosure = ({ title = "Advanced settings", children, defaultOpen = false, className }: { title?: string; children: ReactNode; defaultOpen?: boolean; className?: string }) => {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn("rounded-lg border border-adm-divider", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 min-h-[48px] text-left text-[14px] font-semibold text-adm-ink rounded-lg hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary"
      >
        {title}
        <AdminIcon name="chevron-down" className={cn("text-adm-muted transition-transform", open && "rotate-180")} />
      </button>
      <div id={`${id}-panel`} hidden={!open} className="px-4 pb-4 pt-1 space-y-4 border-t border-adm-divider">{children}</div>
    </div>
  );
};
