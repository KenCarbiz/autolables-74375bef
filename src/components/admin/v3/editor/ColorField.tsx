import { useId } from "react";
import { colorError, contrastRatio, DARK_SURFACE_HEX, formatRatio, normalizeHex, AA_NORMAL_TEXT, WHITE_HEX } from "@/lib/admin/color";
import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";
import { INPUT_CLASS } from "./EditorLayout";

const Contrast = ({ hex, against, label }: { hex: string; against: string; label: string }) => {
  const ratio = contrastRatio(hex, against);
  const pass = ratio >= AA_NORMAL_TEXT;
  return (
    <li className="flex items-center gap-2 text-[13px] leading-[18px]">
      <AdminIcon name={pass ? "check-circle" : "alert"} size="inline" className={pass ? "text-adm-success" : "text-adm-warning"} />
      <span className="text-adm-ink">{label}: <span className="tabular-nums">{formatRatio(ratio)}</span></span>
      <span className={cn("font-semibold", pass ? "text-adm-success" : "text-adm-warning")}>{pass ? "Passes AA" : "Fails AA for body text"}</span>
    </li>
  );
};

/**
 * Controlled by the raw text so the parent can see (and block on) an invalid entry. A valid entry is normalized
 * to uppercase #RRGGBB on blur and whenever the native picker is used.
 */
export const ColorField = ({
  name,
  value,
  onChange,
  role,
  disabled,
  showContrast = true,
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  role?: string;
  disabled?: boolean;
  showContrast?: boolean;
}) => {
  const id = useId();
  const normalized = normalizeHex(value);
  const error = colorError(value);
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={`${id}-hex`} className="block text-[14px] leading-[20px] font-medium text-adm-ink">
        {name}
        {role && <span className="ml-2 text-[13px] font-normal text-adm-muted">{role}</span>}
      </label>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          data-swatch=""
          className="w-10 h-10 rounded-md border border-adm-border flex-shrink-0"
          style={{ backgroundColor: normalized ?? "transparent", backgroundImage: normalized ? undefined : "repeating-linear-gradient(45deg, rgb(var(--adm-border)) 0 4px, transparent 4px 8px)" }}
        />
        <input
          id={`${id}-hex`}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={7}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (normalized && normalized !== value) onChange(normalized); }}
          className={cn(INPUT_CLASS, "w-[128px] font-mono uppercase")}
        />
        <input
          type="color"
          aria-label={`${name} color picker`}
          value={normalized ?? "#000000"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="w-10 h-10 max-sm:w-11 max-sm:h-11 p-1 rounded-md border border-adm-border bg-adm-surface cursor-pointer disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary"
        />
      </div>
      {error && (
        <p id={`${id}-err`} role="alert" className="flex items-start gap-1.5 text-[13px] leading-[18px] font-medium text-adm-danger">
          <AdminIcon name="alert" size="inline" className="mt-px" />
          {error}
        </p>
      )}
      {showContrast && normalized && (
        <ul aria-label={`${name} contrast`} className="space-y-0.5">
          <Contrast hex={normalized} against={WHITE_HEX} label="On white" />
          <Contrast hex={normalized} against={DARK_SURFACE_HEX} label="On dark surface" />
        </ul>
      )}
    </div>
  );
};
