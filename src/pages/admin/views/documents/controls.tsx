import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useInstantSave } from "@/hooks/useInstantSave";
import { useAdminFixture } from "@/lib/admin/dataSource";
import { isUnchanged } from "@/lib/admin/reviewApply";
import { StatusChip } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_META: Record<SaveState, { tone: "neutral" | "info" | "success" | "danger"; label: string }> = {
  idle: { tone: "neutral", label: "Saves automatically" },
  saving: { tone: "info", label: "Saving…" },
  saved: { tone: "success", label: "Saved" },
  error: { tone: "danger", label: "Not saved" },
};

export const SaveStatus = ({ status }: { status: SaveState }) => (
  <StatusChip tone={SAVE_META[status].tone} icon={status !== "idle"}>
    {SAVE_META[status].label}
  </StatusChip>
);

export const PolicySwitch = ({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cn("relative w-9 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", checked ? "bg-adm-primary" : "bg-adm-border")}
  >
    <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "")} />
  </button>
);

export const ToggleRow = ({ label, detail, checked, onChange, disabled, children }: { label: string; detail?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; children?: ReactNode }) => (
  <div className="py-3">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{label}</p>
        {detail && <p className="mt-0.5 text-[12px] leading-[18px] text-adm-muted">{detail}</p>}
      </div>
      <PolicySwitch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
    {children}
  </div>
);

export const INPUT_CLASS = "w-full min-h-[36px] px-3 rounded-md border border-adm-border bg-adm-surface text-[14px] leading-[20px] text-adm-ink outline-none focus:border-adm-primary disabled:opacity-50";
export const TEXTAREA_CLASS = `${INPUT_CLASS} py-2 resize-none`;
export const FIELD_LABEL = "block text-[12px] leading-[18px] font-semibold text-adm-muted mb-1";

/** Legacy `&panel=` deep links scroll to the card with that id; nothing is read or written. */
export function usePanelAnchor() {
  const [params] = useSearchParams();
  const panel = params.get("panel");
  useEffect(() => {
    if (!panel) return;
    const el = document.getElementById(panel);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [panel]);
}

const pick = (v: Record<string, unknown>, keys: string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, v[k]]));

/**
 * Instant save for low-risk operational copy: a draft hydrated from the known
 * settings, written only after an edit, only the keys that changed, with a
 * visible status. Disabled inside a design fixture.
 */
export function useInstantSettings<T extends Partial<DealerSettings>>(read: (s: DealerSettings) => T, opts: { toastId: string; delay?: number }) {
  const { settings, updateSettings, loading } = useDealerSettings();
  const fixture = useAdminFixture();
  const readRef = useRef(read);
  readRef.current = read;
  const [draft, setDraft] = useState<T>(() => readRef.current(settings));
  const savedRef = useRef<T>(draft);
  const hydratedRef = useRef(!loading);
  const [ready, setReady] = useState(!loading);
  const [status, setStatus] = useState<SaveState>("idle");

  useEffect(() => {
    if (loading || hydratedRef.current) return;
    hydratedRef.current = true;
    const next = readRef.current(settings);
    savedRef.current = next;
    setDraft(next);
    setReady(true);
  }, [loading, settings]);

  useInstantSave(
    draft,
    async (v) => {
      const current = v as Record<string, unknown>;
      const saved = savedRef.current as Record<string, unknown>;
      const changed = Object.keys(current).filter((k) => !isUnchanged(current[k], saved[k]));
      if (!changed.length) return true;
      setStatus("saving");
      const ok = await updateSettings(pick(current, changed) as Partial<DealerSettings>);
      if (ok) savedRef.current = v;
      setStatus(ok ? "saved" : "error");
      return ok;
    },
    { ready, enabled: !fixture, toastId: opts.toastId, delay: opts.delay },
  );

  const patch = useCallback((p: Partial<T>) => setDraft((d) => ({ ...d, ...p })), []);

  return { draft, patch, status };
}
