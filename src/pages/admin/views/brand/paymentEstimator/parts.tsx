import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { parseNumberInput } from "@/lib/payment/estimator";

// Small controls for the payment estimator editor, drawn on the Administration
// V2 tokens. Every interactive element is at least 44px tall on phones and
// carries a visible focus ring and a real label.

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}

export function Switch({ id, checked, onChange, disabled, label, labelledBy, describedBy }: {
  id?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string; labelledBy?: string; describedBy?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("group inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md disabled:cursor-not-allowed", FOCUS)}
    >
      <span className={cn("relative h-6 w-11 rounded-full transition-colors group-disabled:opacity-50", checked ? "bg-adm-primary" : "bg-[#B8C4D3]")}>
        <span className={cn("absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none", checked && "translate-x-5")} />
      </span>
    </button>
  );
}

export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const [id] = useState(() => `sw-${Math.random().toString(36).slice(2, 9)}`);
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="min-w-0">
        <p id={`${id}-l`} className="text-[14px] leading-[20px] font-semibold text-adm-ink">{label}</p>
        {hint && <p id={`${id}-h`} className="text-[12px] leading-[18px] text-adm-muted">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} labelledBy={`${id}-l`} describedBy={hint ? `${id}-h` : undefined} />
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, disabled }: {
  value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: ReactNode }>; label: string; disabled?: boolean;
}) {
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => document.getElementById(`seg-${label}-${next.value}`)?.focus());
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={`seg-${label}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            }}
            className={cn(
              "inline-flex min-h-[44px] flex-1 basis-[140px] items-center justify-center gap-2 rounded-md border px-4 text-[14px] font-semibold disabled:opacity-60",
              on ? "border-adm-primary bg-adm-primary text-white" : "border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace",
              FOCUS,
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A number input that keeps what the person typed (so "7." or "" survive a
 * rerender) and reports a parsed value: null for blank, NaN for unparsable.
 */
export function NumberField({ id, value, onChange, prefix, suffix, invalid, describedBy, disabled, label, labelledBy, className, inputClassName, placeholder, inputMode = "decimal" }: {
  id: string; value: number | null; onChange: (v: number | null) => void; prefix?: string; suffix?: string; invalid?: boolean;
  describedBy?: string; disabled?: boolean; label?: string; labelledBy?: string; className?: string; inputClassName?: string; placeholder?: string; inputMode?: "decimal" | "numeric";
}) {
  const fmt = (v: number | null) => (v == null || Number.isNaN(v) ? "" : String(v));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    const parsed = parseNumberInput(text);
    const same = parsed === value || (parsed != null && value != null && Number.isNaN(parsed) && Number.isNaN(value));
    if (!same) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative flex items-center", className)}>
      {prefix && <span className="pointer-events-none absolute left-3 text-[14px] text-adm-muted" aria-hidden="true">{prefix}</span>}
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onChange={(e) => { setText(e.target.value); onChange(parseNumberInput(e.target.value)); }}
        className={cn(
          "h-11 w-full rounded-md border bg-adm-surface text-[14px] leading-[20px] text-adm-ink tabular-nums placeholder:text-adm-muted/70 disabled:bg-adm-workspace disabled:text-adm-muted",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary",
          prefix ? "pl-7" : "pl-3", suffix ? "pr-8" : "pr-3",
          invalid ? "border-adm-danger" : "border-adm-border",
          inputClassName,
        )}
      />
      {suffix && <span className="pointer-events-none absolute right-3 text-[14px] text-adm-muted" aria-hidden="true">{suffix}</span>}
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className="mt-1 text-[12px] leading-[18px] text-adm-danger">{children}</p>;
}

export const fieldDomId = (path: string) => `pe-${path.replace(/[^a-zA-Z0-9]+/g, "-")}`;
