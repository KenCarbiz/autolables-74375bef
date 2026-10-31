import { createContext, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, type Tone } from "@/components/product";
import { cn } from "@/lib/utils";
import { explainError, type DealerGroup, type InvOverview, type StoreDraft, type StoreOverview } from "@/lib/inventoryNetwork/api";

export type View = "overview" | "stores" | "sharing" | "marketcheck" | "mapping" | "runs" | "preview" | "pilot" | "catalog" | "deliveries" | "duplicates";
export const VIEW_PATH = "/admin/integrations/inventory-network";

export interface Notice { tone: Tone; text: string }

export interface NetContextValue {
  groupId: string;
  group: DealerGroup;
  overview: InvOverview;
  stores: StoreOverview[];
  notify: (tone: Tone, text: string) => void;
  refresh: () => void;
  href: (view: View, params?: Record<string, string>) => string;
  go: (view: View, params?: Record<string, string>) => void;
  newStoreDraft: Partial<StoreDraft> | null;
  startNewStore: (prefill: Partial<StoreDraft>) => void;
  clearNewStoreDraft: () => void;
}

const Ctx = createContext<NetContextValue | null>(null);
export const NetProvider = ({ value, children }: { value: NetContextValue; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export function useNet(): NetContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNet outside the inventory network page");
  return v;
}

export function useAct() {
  const { notify, refresh } = useNet();
  const [busy, setBusy] = useState(false);
  const act = async <T,>(fn: () => Promise<T>, success: string): Promise<{ ok: true; value: T } | { ok: false }> => {
    setBusy(true);
    try {
      const value = await fn();
      notify("success", success);
      refresh();
      return { ok: true, value };
    } catch (e) {
      notify("danger", explainError(e));
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };
  return { act, busy };
}

export const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "Never");
export const fileName = (p: string) => p.split("/").pop() ?? p;
export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "");
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : "");
export const storeAddress = (s: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }) =>
  [s.street, [s.city, s.state].filter(Boolean).join(", "), s.zip].filter(Boolean).join(" ");

export const STATUS_TONE: Record<string, Tone> = {
  applied: "success", passed: "success", approved: "success", succeeded: "success", ready: "success", match: "success", active: "success", subscribed: "success",
  quarantined: "warning", held: "warning", partial: "warning", mapping_pending: "warning", pending: "info", staged: "info", running: "info", queued: "info", incomplete: "warning",
  rejected: "danger", failed: "danger", dead: "danger", conflict: "danger", mismatch: "danger", suspended: "danger",
  superseded: "neutral", skipped: "neutral", cancelled: "neutral", disabled: "neutral", unmapped: "neutral", unknown: "neutral", revoked: "neutral", unsubscribed: "neutral", inactive: "neutral",
};

export const inputClass = "w-full rounded-[4px] border border-adm-border bg-adm-surface px-3 py-2 text-[14px] text-adm-ink disabled:bg-adm-workspace disabled:text-adm-muted";

export function TextField({ id, label, value, onChange, hint, error, type = "text", disabled, placeholder, className }: {
  id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string | null; type?: string; disabled?: boolean; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-adm-ink">{label}</label>
      <input id={id} type={type} className={cn(inputClass, error && "border-adm-danger")} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} aria-invalid={!!error} />
      {error ? <p className="mt-1 text-[12px] text-adm-danger">{error}</p> : hint && <p className="mt-1 text-[12px] text-adm-muted">{hint}</p>}
    </div>
  );
}

export function NumberField({ id, label, value, onChange, hint, error, min, max, step, disabled, className }: {
  id: string; label: string; value: number | null; onChange: (v: number | null) => void; hint?: string; error?: string | null; min?: number; max?: number; step?: number; disabled?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-adm-ink">{label}</label>
      <input
        id={id} type="number" inputMode="decimal" min={min} max={max} step={step} disabled={disabled} aria-invalid={!!error}
        className={cn(inputClass, error && "border-adm-danger")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      {error ? <p className="mt-1 text-[12px] text-adm-danger">{error}</p> : hint && <p className="mt-1 text-[12px] text-adm-muted">{hint}</p>}
    </div>
  );
}

export function SelectField({ id, label, value, onChange, options, disabled, hint, className }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; disabled?: boolean; hint?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-adm-ink">{label}</label>
      <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="mt-1 text-[12px] text-adm-muted">{hint}</p>}
    </div>
  );
}

export function CheckField({ id, label, checked, onChange, hint, disabled }: { id: string; label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className={cn("min-w-0 text-[14px] leading-[20px]", disabled && "text-adm-muted")}>
        <span className="font-medium text-adm-ink">{label}</span>
        {hint && <span className="block text-[12px] leading-[18px] text-adm-muted">{hint}</span>}
      </label>
    </div>
  );
}

export function ConfirmButton({ label, confirmLabel, onConfirm, disabled, variant = "secondary", size = "sm" }: {
  label: string; confirmLabel?: string; onConfirm: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"; size?: "sm" | "md";
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <Button size={size} variant={variant} disabled={disabled} onClick={() => setArmed(true)}>{label}</Button>;
  return (
    <span className="inline-flex items-center gap-2">
      <Button size={size} variant="danger" disabled={disabled} onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel ?? `Confirm ${label.toLowerCase()}`}</Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)}>Cancel</Button>
    </span>
  );
}

export const NavLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="text-adm-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">{children}</Link>
);

export const mcModeLabel = (policy: { mode: string; budget_blocked: boolean } | null): { label: string; tone: Tone } => {
  if (!policy || policy.mode === "feed_only") return { label: "Feed only", tone: "neutral" };
  if (policy.budget_blocked) return { label: "Budget blocked", tone: "danger" };
  if (policy.mode === "enrichment") return { label: "Enrichment enabled", tone: "info" };
  return { label: "Paused", tone: "warning" };
};

export const money = (n: number | string | null | undefined, digits = 2) =>
  n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? "Unknown" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const NeedsReview = ({ children = "Needs review" }: { children?: ReactNode }) => (
  <span className="rounded-[2px] bg-adm-warning-bg px-2 py-[3px] text-[12px] font-semibold text-[#5F3F00]">{children}</span>
);
