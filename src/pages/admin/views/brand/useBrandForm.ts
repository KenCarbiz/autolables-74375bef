import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import type { Store } from "@/types/tenant";
import { useViewFixture } from "@/lib/admin/dataSource";
import { changedKeys, patchOf, pickSettings, type Draft, type SettingsKey } from "./brandModel";

// The one save model for the brand views: a draft keyed to the tenant and the
// server load generation, diffed against the settings row, saved only on an
// explicit click and only when the server row was actually read. Mounting,
// typing, switching store or a late server answer never writes anything.

export interface BrandFixture {
  settings: Partial<DealerSettings>;
  tenantName?: string;
  stores?: Store[];
  activeStoreId?: string | null;
}

export interface BrandSource {
  settings: DealerSettings;
  tenantId: string | null;
  tenantName: string | null;
  stores: Store[];
  activeStoreId: string | null;
  /** Changes whenever the tenant changes or settings are reloaded. */
  loadKey: string;
  serverLoaded: boolean;
  loadError: string | null;
  loading: boolean;
  isFixture: boolean;
  updateSettings: (patch: Partial<DealerSettings>) => Promise<boolean>;
}

const noWrite = async (): Promise<boolean> => false;

export function useBrandSource(): BrandSource {
  const fixture = useViewFixture<BrandFixture>("brand");
  const ctx = useDealerSettings();
  const { tenant, currentStore, stores } = useTenant();
  const fixtureSettings = fixture?.settings;
  return useMemo<BrandSource>(() => {
    if (fixture) {
      return {
        settings: { ...DEFAULT_SETTINGS, ...(fixtureSettings ?? {}) },
        tenantId: null,
        tenantName: fixture.tenantName ?? null,
        stores: fixture.stores ?? [],
        activeStoreId: fixture.activeStoreId ?? null,
        loadKey: "fixture",
        serverLoaded: true,
        loadError: null,
        loading: false,
        isFixture: true,
        updateSettings: noWrite,
      };
    }
    return {
      settings: ctx.settings,
      tenantId: ctx.tenantId,
      tenantName: tenant?.name && tenant.id !== "house" ? tenant.name : null,
      stores: stores ?? [],
      activeStoreId: currentStore?.id ?? null,
      loadKey: `${ctx.tenantId ?? "none"}:${ctx.loadGeneration}`,
      serverLoaded: ctx.serverLoaded,
      loadError: ctx.loadError,
      loading: ctx.loading,
      isFixture: false,
      updateSettings: ctx.updateSettings,
    };
  }, [fixture, fixtureSettings, ctx.settings, ctx.tenantId, ctx.loadGeneration, ctx.serverLoaded, ctx.loadError, ctx.loading, ctx.updateSettings, tenant?.name, tenant?.id, stores, currentStore?.id]);
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface BrandForm<K extends SettingsKey> {
  draft: Draft<K>;
  original: Draft<K>;
  set: <P extends K>(key: P, value: DealerSettings[P]) => void;
  dirty: boolean;
  changed: K[];
  errors: string[];
  status: SaveStatus;
  error: string | null;
  /** Why saving is impossible right now, independent of the draft. */
  blockedReason: string | null;
  canSave: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  source: BrandSource;
}

/**
 * `keys` and `validate` must be module-level constants: the hook keys its
 * memoisation on their identity.
 */
export function useBrandForm<K extends SettingsKey>(keys: readonly K[], validate?: (draft: Draft<K>) => string[]): BrandForm<K> {
  const source = useBrandSource();
  const original = useMemo(() => pickSettings(source.settings, keys), [source.settings, keys]);
  const [draft, setDraft] = useState<Draft<K>>(original);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const baselineRef = useRef(source.loadKey);

  useEffect(() => {
    if (baselineRef.current === source.loadKey) return;
    baselineRef.current = source.loadKey;
    setDraft(pickSettings(source.settings, keys));
    setStatus("idle");
    setError(null);
  }, [source.loadKey, source.settings, keys]);

  const changed = useMemo(() => changedKeys(draft, original, keys), [draft, original, keys]);
  const dirty = changed.length > 0;
  const errors = useMemo(() => (validate ? validate(draft) : []), [validate, draft]);

  const blockedReason = source.isFixture
    ? "Design fixture: saving is disabled."
    : source.loading
      ? "Settings are still loading."
      : !source.serverLoaded
        ? "Settings could not be read from the server, so nothing can be saved until they load."
        : null;
  const canSave = dirty && errors.length === 0 && !blockedReason && status !== "saving";

  const set = useCallback(<P extends K>(key: P, value: DealerSettings[P]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setStatus("idle");
    setError(null);
  }, []);

  const discard = useCallback(() => {
    setDraft(original);
    setStatus("idle");
    setError(null);
  }, [original]);

  const save = useCallback(async () => {
    if (!canSave) return false;
    setStatus("saving");
    setError(null);
    // A writer that throws is a refused save too; the bar must leave "saving".
    let ok = false;
    try {
      ok = await source.updateSettings(patchOf(draft, original, keys));
    } catch {
      ok = false;
    }
    if (ok) {
      setStatus("saved");
      return true;
    }
    setStatus("error");
    setError("The server did not accept the change. Nothing was saved.");
    return false;
  }, [canSave, source, draft, original, keys]);

  return { draft, original, set, dirty, changed, errors, status, error, blockedReason, canSave, save, discard, source };
}
