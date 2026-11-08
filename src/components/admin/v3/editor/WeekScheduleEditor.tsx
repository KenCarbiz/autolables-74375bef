import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SelectField, SwitchField } from "./FormControls";

export const WEEK_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export interface DaySchedule {
  open: boolean;
  /** 24-hour "HH:MM" */
  from: string;
  /** 24-hour "HH:MM"; "24:00" closes at midnight at the end of the day. Earlier than `from` means it closes the next day. */
  to: string;
  /** Open around the clock. from and to are ignored. */
  allDay?: boolean;
}
export type WeekSchedule = Record<WeekDay, DaySchedule>;

export const END_OF_DAY = "24:00";

const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function timeOptions(stepMinutes = 30, includeEndOfDay = false): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += stepMinutes) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  if (includeEndOfDay) out.push(END_OF_DAY);
  return out;
}

export function formatTime(value: string): string {
  if (value === END_OF_DAY) return "Midnight";
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export const closesNextDay = (d: DaySchedule): boolean => d.open && !d.allDay && d.to !== END_OF_DAY && minutes(d.to) < minutes(d.from);

/** Zero-length ranges are rejected. An earlier close is overnight hours, not an error. */
export function dayError(d: DaySchedule): string | null {
  return d.open && !d.allDay && d.to === d.from ? "Closing time must differ from opening time. Choose Open 24 hours for all-day service." : null;
}

export function weekErrors(week: WeekSchedule): Partial<Record<WeekDay, string>> {
  const out: Partial<Record<WeekDay, string>> = {};
  for (const day of WEEK_DAYS) {
    const e = dayError(week[day]);
    if (e) out[day] = e;
  }
  return out;
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
  const error = dayError(value);
  const fromOptions = timeOptions(step);
  const toOptions = timeOptions(step, true);
  const select = (which: "from" | "to") => {
    const options = which === "from" ? fromOptions : toOptions;
    return (
      <SelectField
        aria-label={`${day} ${which === "from" ? "opens" : "closes"}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        disabled={disabled}
        value={value[which]}
        onChange={(e) => onChange({ ...value, [which]: e.target.value })}
        wrapperClassName="flex-1 min-w-0 md:flex-none md:w-auto"
        className="w-full md:min-w-[112px]"
      >
        {!options.includes(value[which]) && <option value={value[which]}>{formatTime(value[which])}</option>}
        {options.map((o) => <option key={o} value={o}>{formatTime(o)}</option>)}
      </SelectField>
    );
  };
  return (
    <div
      role="group"
      aria-label={day}
      data-day={day}
      className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 py-3 md:py-2 md:gap-y-1 md:grid-cols-[96px_104px_minmax(0,1fr)_176px] md:gap-x-4 md:min-h-[60px]"
    >
      <span className="text-[14px] leading-[20px] font-medium text-adm-ink">{day}</span>
      <SwitchField label="Open" ariaLabel={`${day} open`} checked={value.open} disabled={disabled} onChange={(open) => onChange({ ...value, open })} />
      <div className="col-span-2 md:col-span-1 min-w-0">
        {value.open ? (
          !value.allDay ? (
            <span className="flex items-center gap-2 flex-wrap md:flex-nowrap">
              {select("from")}
              <span aria-hidden="true" className="shrink-0 text-adm-muted">to</span>
              {select("to")}
              {closesNextDay(value) && <span className="basis-full md:basis-auto text-[13px] leading-[18px] text-adm-muted whitespace-nowrap">closes next day</span>}
            </span>
          ) : (
            <span className="text-[14px] text-adm-muted">Open around the clock</span>
          )
        ) : (
          <span className="text-[14px] text-adm-muted">Closed</span>
        )}
      </div>
      <div className="col-span-2 md:col-span-1 md:col-start-4 md:row-start-1 justify-self-start whitespace-nowrap empty:hidden">
        {value.open && <SwitchField label="Open 24 hours" ariaLabel={`${day} open 24 hours`} checked={Boolean(value.allDay)} disabled={disabled} onChange={(allDay) => onChange({ ...value, allDay })} />}
      </div>
      {error && <p id={`${id}-err`} role="alert" className="col-span-2 md:col-span-4 text-[13px] leading-[18px] font-medium text-adm-danger">{error}</p>}
    </div>
  );
};

/** Seven day rows plus a slot for the timezone control. No persistence: the parent owns the schedule value. Use weekErrors() in the draft validator. */
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
    <div className={cn("divide-y divide-adm-divider border-y border-adm-divider")}>
      {WEEK_DAYS.map((day) => (
        <TimeRangeRow key={day} day={day} value={value[day]} disabled={disabled} step={step} onChange={(next) => onChange({ ...value, [day]: next })} />
      ))}
    </div>
  </div>
);
