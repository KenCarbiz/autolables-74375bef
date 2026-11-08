import type { ReactNode } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, type AdminIconName } from "@/components/admin/v3/editor";
import { cn } from "@/lib/utils";
import type { StickerType } from "@/lib/stickerStudio/templates";
import { PAPER_FORMATS, STEPS_BY_UNIT, formatStep, type Direction, type Unit } from "@/lib/admin/printWizard";

export const STEP_LABELS = ["Choose printer and paper", "Print test", "Adjust alignment", "Verify and save"] as const;

export const Stepper = ({ step, onGo }: { step: number; onGo: (n: number) => void }) => (
  <nav aria-label="Printer setup steps">
    <ol className="grid grid-cols-4 gap-2">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const current = n === step;
        const done = n < step;
        return (
          <li key={label} className="min-w-0">
            <button
              type="button"
              onClick={() => onGo(n)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "w-full min-h-[44px] flex items-center justify-center sm:justify-start gap-2 rounded-lg border px-2 sm:px-3 py-2 text-left text-[14px] leading-[18px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary",
                current ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-divider bg-adm-surface text-adm-ink hover:bg-adm-workspace",
              )}
            >
              <span aria-hidden="true" className={cn("inline-grid place-items-center w-7 h-7 rounded-full flex-shrink-0 text-[13px]", current ? "bg-adm-primary text-white" : done ? "bg-adm-success-bg text-adm-success" : "bg-adm-workspace text-adm-muted")}>
                {done ? <AdminIcon name="check" size="compact" /> : n}
              </span>
              <span className="min-w-0 max-sm:sr-only">{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
    <p className="sm:hidden mt-2 text-[14px] font-semibold text-adm-ink">Step {step} of 4: {STEP_LABELS[step - 1]}</p>
  </nav>
);

export const Callout = ({ icon = "info", tone = "info", title, children }: { icon?: AdminIconName; tone?: "info" | "warning" | "neutral"; title?: ReactNode; children: ReactNode }) => (
  <div role="note" className={cn("rounded-lg border px-4 py-3 flex items-start gap-3", tone === "warning" ? "border-adm-warning/40 bg-adm-warning-bg" : tone === "info" ? "border-adm-divider bg-adm-selected" : "border-adm-divider bg-adm-workspace")}>
    <AdminIcon name={icon} size="card" className={cn("mt-0.5", tone === "warning" ? "text-adm-warning" : "text-adm-primary")} />
    <div className="min-w-0 text-[14px] leading-[20px] text-adm-ink">
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-0.5")}>{children}</div>
    </div>
  </div>
);

export const FormatPicker = ({ value, onChange, compact = false }: { value: StickerType; onChange: (t: StickerType) => void; compact?: boolean }) => (
  <div role="radiogroup" aria-label="Paper format" className="grid grid-cols-2 gap-3">
    {PAPER_FORMATS.map((f) => {
      const on = f.type === value;
      const h = 56;
      const w = Math.round((h * f.widthIn) / f.heightIn);
      return (
        <button
          key={f.type}
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => onChange(f.type)}
          className={cn("min-h-[44px] rounded-lg border p-3 flex items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", on ? "border-adm-primary bg-adm-selected" : "border-adm-divider bg-adm-surface hover:bg-adm-workspace")}
        >
          <svg width={w + 4} height={h + 4} aria-hidden="true" className="flex-shrink-0"><rect x="2" y="2" width={w} height={h} fill="#fff" stroke={on ? "#2457D6" : "#8A94A6"} strokeWidth="2" /></svg>
          <span className="min-w-0">
            <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{f.name}</span>
            <span className="block text-[13px] leading-[18px] text-adm-muted">{compact ? f.sizeLabel : `${f.sizeLabel}, ${f.use.toLowerCase()}`}</span>
          </span>
        </button>
      );
    })}
  </div>
);

const ARROW: Record<Direction, AdminIconName> = { up: "arrow-up", down: "arrow-down", left: "arrow-left", right: "arrow-right" };
const WORD: Record<Direction, string> = { up: "up", down: "down", left: "left", right: "right" };

export const DirectionPad = ({ stepLabel, disabled, can, onMove }: { stepLabel: string; disabled?: boolean; can: (d: Direction) => boolean; onMove: (d: Direction) => void }) => {
  const btn = (d: Direction, cls: string) => (
    <AdminButton
      variant="secondary"
      aria-label={`Move print ${WORD[d]} ${stepLabel}`}
      disabled={disabled || !can(d)}
      onClick={() => onMove(d)}
      className={cn("!w-12 !h-12 !min-h-[48px] !p-0 justify-center", cls)}
    >
      <AdminIcon name={ARROW[d]} size="card" />
    </AdminButton>
  );
  return (
    <div role="group" aria-label="Move the print" className="grid grid-cols-3 gap-2 w-fit">
      {btn("up", "col-start-2")}
      {btn("left", "col-start-1 row-start-2")}
      <span aria-hidden="true" className="col-start-2 row-start-2 grid place-items-center text-adm-muted"><AdminIcon name="printer" size="card" /></span>
      {btn("right", "col-start-3 row-start-2")}
      {btn("down", "col-start-2 row-start-3")}
    </div>
  );
};

export const UnitToggle = ({ unit, onChange }: { unit: Unit; onChange: (u: Unit) => void }) => (
  <div role="radiogroup" aria-label="Units" className="inline-flex rounded-lg border border-adm-border overflow-hidden">
    {(["in", "mm"] as const).map((u) => (
      <button key={u} type="button" role="radio" aria-checked={unit === u} onClick={() => onChange(u)} className={cn("min-h-[44px] sm:min-h-[40px] min-w-[64px] px-4 text-[14px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary", unit === u ? "bg-adm-primary text-white" : "bg-adm-surface text-adm-ink hover:bg-adm-workspace")}>
        {u === "in" ? "Inches" : "Millimeters"}
      </button>
    ))}
  </div>
);

export const StepPicker = ({ unit, index, onChange }: { unit: Unit; index: number; onChange: (i: number) => void }) => (
  <div role="radiogroup" aria-label="Move by" className="flex flex-wrap gap-2">
    {STEPS_BY_UNIT[unit].map((s, i) => (
      <button key={s} type="button" role="radio" aria-checked={index === i} onClick={() => onChange(i)} className={cn("min-h-[44px] sm:min-h-[40px] min-w-[72px] rounded-lg border px-3 text-[14px] font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", index === i ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace")}>
        {formatStep(s, unit)}
      </button>
    ))}
  </div>
);
