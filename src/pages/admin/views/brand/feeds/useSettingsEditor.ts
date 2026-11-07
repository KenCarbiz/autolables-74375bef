import { useCallback, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useViewFixture } from "@/lib/admin/dataSource";
import { useEditorDraft, type DraftErrors } from "@/lib/admin/useEditorDraft";
import { useSaveFlow } from "@/lib/admin/useSaveFlow";
import { deriveDraftBarState, useLeaveGuard, type ReviewChangeRow } from "@/components/admin/v3/editor";
import { useBrandSource, type BrandSource } from "../useBrandForm";

export type FixtureVariant = "default" | "empty" | "invalid" | "readonly" | "error" | "paused" | "match" | "ambiguous" | "missing" | "variant" | "none" | "partial" | "broken" | "conflict";

const VARIANTS: readonly FixtureVariant[] = ["default", "empty", "invalid", "readonly", "error", "paused", "match", "ambiguous", "missing", "variant", "none", "partial", "broken", "conflict"];

export function useFixtureVariant(active: boolean): FixtureVariant {
  const { search } = useLocation();
  if (!active) return "default";
  const raw = new URLSearchParams(search).get("state") as FixtureVariant | null;
  return raw && VARIANTS.includes(raw) ? raw : "default";
}

export interface FeedsFixtureSlice<R = unknown> {
  seeds?: Partial<Record<FixtureVariant, Partial<DealerSettings>>>;
  results?: Partial<Record<FixtureVariant, R>>;
  [extra: string]: unknown;
}

export interface SettingsEditorOptions<T extends Record<string, unknown>> {
  /** Reads the editable values out of the dealer settings row. Must be a module-level function. */
  read: (settings: DealerSettings) => T;
  /** Turns the changed values into the patch the existing settings writer takes. */
  toPatch: (changed: Partial<T>, settings: DealerSettings) => Partial<DealerSettings>;
  labels: Partial<Record<keyof T & string, string>>;
  validate?: (draft: T) => DraftErrors<T>;
  describe?: (key: keyof T & string, value: unknown) => string;
  /** The design fixture slice key. Its `seeds` layer values over the fixture settings for a named state. */
  fixtureViewId?: string;
}

export function pickRead<K extends keyof DealerSettings & string>(keys: readonly K[]) {
  return (s: DealerSettings): Pick<DealerSettings, K> => {
    const out = {} as Pick<DealerSettings, K>;
    for (const k of keys) out[k] = s[k];
    return out;
  };
}

export const directPatch = <T extends Record<string, unknown>>(changed: Partial<T>) => changed as unknown as Partial<DealerSettings>;

export const defaultDescribe = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  return JSON.stringify(value);
};

/**
 * One draft, review and apply model for the Websites, Document defaults and Store settings editors. Values come
 * from the dealer settings row, the draft never writes on load, and only Apply on the review dialog calls the
 * existing settings writer with the values that changed.
 */
export function useSettingsEditor<T extends Record<string, unknown>>(opts: SettingsEditorOptions<T>) {
  const source: BrandSource = useBrandSource();
  const variant = useFixtureVariant(source.isFixture);
  const { reload } = useDealerSettings();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const fixture = useViewFixture<FeedsFixtureSlice>(opts.fixtureViewId ?? "none");
  const settings = useMemo<DealerSettings>(
    () => (source.isFixture && fixture?.seeds?.[variant] ? { ...source.settings, ...fixture.seeds[variant] } : source.settings),
    [source.isFixture, source.settings, fixture, variant],
  );
  const live = useMemo(() => opts.read(settings), [settings, opts]);
  const [pinned, setPinned] = useState<T | null>(null);
  const baseline = source.loading && !source.isFixture ? undefined : (pinned ?? live);

  const canEdit = source.isFixture ? variant !== "readonly" : hasDealerCapability(member?.role, "can_manage_settings", isAdmin);
  const unreadable = source.isFixture ? variant === "error" : !source.loading && !source.serverLoaded;
  const blockedReason = unreadable
    ? "Settings could not be read from the server, so nothing can be saved until they load."
    : source.isFixture ? "Design fixture: saving is disabled."
    : source.loading ? "Settings are still loading." : null;

  const edit = useEditorDraft<T>({ scopeKey: source.loadKey, baseline, validate: opts.validate });
  const flow = useSaveFlow(source.loadKey);
  const dirty = edit.dirty;
  const guard = useLeaveGuard(dirty);

  const patch = useMemo(() => {
    if (!edit.draft) return {} as Partial<DealerSettings>;
    const changed: Partial<T> = {};
    for (const c of edit.changes) changed[c.key] = edit.draft[c.key] as T[typeof c.key];
    return opts.toPatch(changed, settings);
  }, [edit.changes, edit.draft, opts, settings]);

  const rows: ReviewChangeRow[] = useMemo(() => {
    const describe = opts.describe ?? ((_k: string, v: unknown) => defaultDescribe(v));
    return edit.changes.map((c) => ({ id: c.key, label: opts.labels[c.key] ?? c.key, before: describe(c.key, c.before), after: describe(c.key, c.after) }));
  }, [edit.changes, opts]);

  // A value that was already invalid when the page opened must not block an unrelated change, so only errors on
  // the keys this draft touches stop Review and Apply.
  const blocking = useMemo(() => {
    const changed = new Set<string>(edit.changedKeys);
    return Object.fromEntries(Object.entries(edit.errors).filter(([k, v]) => v && changed.has(k))) as Record<string, string>;
  }, [edit.errors, edit.changedKeys]);
  const valid = Object.keys(blocking).length === 0;
  const firstError = Object.values(blocking)[0];
  const barState = deriveDraftBarState({ phase: flow.phase, dirty, changeCount: edit.changes.length, firstError, message: flow.message });
  const canApply = canEdit && !blockedReason && valid && dirty && flow.phase !== "saving";

  const apply = useCallback(async () => {
    if (!canApply || !baseline) return false;
    setPinned(baseline);
    const ok = await flow.run(async () => {
      let accepted = false;
      try {
        accepted = await source.updateSettings(patch);
      } catch {
        accepted = false;
      }
      if (!accepted) throw new Error("The server did not accept the change");
    });
    if (ok) {
      edit.markSaved();
      setPinned(null);
    }
    return ok;
  }, [canApply, baseline, flow, source, patch, edit]);

  const discard = useCallback(() => {
    edit.reset();
    flow.dismiss();
    if (pinned) {
      setPinned(null);
      if (!source.isFixture) void reload();
    }
  }, [edit, flow, pinned, source.isFixture, reload]);

  return { source, settings, fixture, variant, canEdit, unreadable, blockedReason, edit, blocking, flow, dirty, guard, rows, barState, canApply, apply, discard, refresh: discard };
}
