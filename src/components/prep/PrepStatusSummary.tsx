import { Check, Clock, Lock } from "lucide-react";

export type PrepStatusState = "pending" | "complete" | "locked";

export interface PrepStatusRow {
  label: string;
  state: PrepStatusState;
}

const badge: Record<PrepStatusState, { cls: string; text: string; Icon: typeof Check }> = {
  pending: { cls: "bg-amber-50 text-amber-700", text: "Pending", Icon: Clock },
  complete: { cls: "bg-emerald-50 text-emerald-700", text: "Complete", Icon: Check },
  locked: { cls: "bg-muted text-muted-foreground", text: "Locked", Icon: Lock },
};

const PrepStatusSummary = ({ rows }: { rows: PrepStatusRow[] }) => (
  <div className="rounded-2xl bg-card border border-border shadow-premium divide-y divide-border overflow-hidden">
    {rows.map((row) => {
      const b = badge[row.state];
      return (
        <div key={row.label} className="min-h-[48px] px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">{row.label}</span>
          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg ${b.cls}`}>
            <b.Icon className="w-3.5 h-3.5" /> {b.text}
          </span>
        </div>
      );
    })}
  </div>
);

export default PrepStatusSummary;
