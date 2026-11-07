import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { INPUT_CLASS } from "./EditorLayout";

export const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export interface DaySchedule {
  open: boolean;
  /** 24-hour "HH:MM" */
  from: string;
  to: string;
}
export type WeekSchedule = Record<WeekDay, DaySchedule>;

export function timeOptions(stepMinutes = 30): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}

export function formatTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Returns an error for a day whose close is not after its open. */
export function dayError(d: DaySchedule): string | null {
  return d.open && d.to <= d.from ? "Closing time must be after opening time." : null;
}

export const TimeRangeRow = ({
  day,
  value,
  onChange,
  step = 30,
  disabled,
}: {
  day: string;
  value: DaySchedule;
  onChange: (next: DaySchedule) => void;
  step?: number;
  disabled?: boolean;
}) => {
  const id = useId();
  const options = timeOptions(step);
  const error = dayError(value);
  const sel = (which: "from" | "to") => (
    <select
      id={`${id}-${which}`}
      aria-label={`${day} ${which === "from" ? "opens" : "closes"}`}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-err` : undefined}
      disabled={disabled || !value.open}
      value={value[which]}
      onChange={(e) => onChange({ ...value, [which]: e.target.value })}
      className={cn(INPUT_CLASS, "w-auto min-w-[112px]")}
    >
      {!options.includes(value[which]) && <option value={value[which]}>{formatTime(value[which])}</option>}
      {options.map((o) => <option key={o} value={o}>{formatTime(o)}</option>)}
    </select>
  );
  return (
    <div role="group" aria-label={day} className="grid grid-cols-[1fr_auto] sm:grid-cols-[120px_150px_1fr] items-center gap-x-4 gap-y-2 py-3">
      <span className="text-[14px] leading-[20px] font-medium text-adm-ink">{day}</span>
      <label className="inline-flex items-center gap-2 min-h-[40px] text-[14px] text-adm-ink cursor-pointer justify-self-end sm:justify-self-start">
        <input
          type="checkbox"
          role="switch"
          checked={value.open}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, open: e.target.checked })}
          aria-label={`${day} open`}
          className="w-6 h-6 max-sm:w-7 max-sm:h-7 accent-[rgb(var(--adm-primary))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary"
        />
        <span>{value.open ? "Open" : "Closed"}</span>
      </label>
      <div className="col-span-2 sm:col-span-1 flex items-center gap-2 flex-wrap">
        {value.open ? (
          <>
            {sel("from")}
            <span aria-hidden="true" className="text-adm-muted">to</span>
            {sel("to")}
          </>
        ) : (
          <span className="text-[14px] text-adm-muted">Closed all day</span>
        )}
      </div>
      {error && <p id={`${id}-err`} role="alert" className="col-span-2 sm:col-start-3 text-[13px] leading-[18px] font-medium text-adm-danger">{error}</p>}
    </div>
  );
};

/** Seven day rows plus a slot for the timezone control. No persistence: the parent owns the schedule value. */
export const WeekScheduleEditor = ({
  value,
  onChange,
  timezoneSlot,
  disabled,
  step,
}: {
  value: WeekSchedule;
  onChange: (next: WeekSchedule) => void;
  timezoneSlot?: ReactNode;
  disabled?: boolean;
  step?: number;
}) => (
  <div className="space-y-4">
    {timezoneSlot && <div data-slot="timezone">{timezoneSlot}</div>}
    <div className="divide-y divide-adm-divider border-y border-adm-divider">
      {WEEK_DAYS.map((day) => (
        <TimeRangeRow key={day} day={day} value={value[day]} disabled={disabled} step={step} onChange={(next) => onChange({ ...value, [day]: next })} />
      ))}
    </div>
  </div>
);
