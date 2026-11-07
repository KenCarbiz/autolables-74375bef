import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasAnyDealerCapability, type DealerRole } from "@/lib/permissions/dealerRoleCapabilities";
import { useViewFixture } from "@/lib/admin/dataSource";
import { useEditorDraft, type DraftErrors, type EditorDraftChange } from "@/lib/admin/useEditorDraft";
import { useSaveFlow } from "@/lib/admin/useSaveFlow";
import { deriveDraftBarState, useLeaveGuard, type ReviewChangeRow } from "@/components/admin/v3/editor";
import type { DealerSettings } from "@/contexts/DealerSettingsContext";
import { useBrandSource, type BrandFixture, type BrandSource } from "../useBrandForm";

export type FixtureState = "default" | "empty" | "error" | "readonly" | "dirty" | "invalid" | "review";

export interface BrandBFixture extends BrandFixture {
  /** Fixture-only extras the Wave B editors read beside the settings row. */
  secondaryColor?: string;
  rooftops?: Array<{ id: string; displayName: string; legalName: string | null; city: string | null; state: string | null }>;
  variants?: Partial<Record<FixtureState, { settings?: Partial<DealerSettings>; seed?: Record<string, unknown>; rooftops?: BrandBFixture["rooftops"]; secondaryColor?: string }>>;
}

export interface BrandEditorContext {
  source: BrandSource;
  fixture: BrandBFixture | null;
  fixtureState: FixtureState;
  canEdit: boolean;
  /** True when the person may change values right now: allowed by role and the settings row was read. */
  editable: boolean;
  /** Why the page cannot save at all, whatever the draft holds. */
  blockedReason: string | null;
  /** Settings with the active fixture variant applied. */
  settings: DealerSettings;
  scopeKey: string;
  rooftopName: string | null;
}

const STATES: FixtureState[] = ["default", "empty", "error", "readonly", "dirty", "invalid", "review"];

export function useBrandEditorContext(): BrandEditorContext {
  const source = useBrandSource();
  const fixture = useViewFixture<BrandBFixture>("brand");
  const [search] = useSearchParams();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const raw = search.get("state") as FixtureState | null;
  const fixtureState: FixtureState = fixture && raw && STATES.includes(raw) ? raw : "default";
  const variant = fixture?.variants?.[fixtureState];
  const settings = useMemo(() => (variant?.settings ? { ...source.settings, ...variant.settings } : source.settings), [source.settings, variant]);
  const role = member?.role as DealerRole | undefined;
  const canEdit = fixture ? fixtureState !== "readonly" : isAdmin || (!!role && hasAnyDealerCapability(role, ["can_manage_settings"]));
  const blockedReason = fixture
    ? fixtureState === "error"
      ? "Settings could not be read from the server, so nothing can be saved until they load."
      : null
    : source.loading
      ? "Settings are still loading."
      : !source.serverLoaded
        ? "Settings could not be read from the server, so nothing can be saved until they load."
        : null;
  const store = source.activeStoreId ? source.stores.find((s) => s.id === source.activeStoreId) : undefined;
  return {
    source,
    fixture,
    fixtureState,
    canEdit,
    editable: canEdit && !blockedReason,
    blockedReason,
    settings,
    scopeKey: `${source.loadKey}:${source.activeStoreId ?? "all"}:${fixtureState}`,
    rooftopName: store?.name ?? null,
  };
}

export interface UseBrandEditorOptions<T extends Record<string, unknown>> {
  ctx: BrandEditorContext;
  baseline: T | undefined;
  validate?: (draft: T) => DraftErrors<T>;
  /** Defaults to the changed top-level keys. */
  buildPatch?: (draft: T, baseline: T, changes: EditorDraftChange<T>[]) => Record<string, unknown>;
  /** Persists the patch. Throws with a person-readable message when the server refused it. */
  write: (patch: Record<string, unknown>, draft: T) => Promise<void>;
  describe: (change: EditorDraftChange<T>) => ReviewChangeRow;
}

export function useBrandEditor<T extends Record<string, unknown>>({ ctx, baseline, validate, buildPatch, write, describe }: UseBrandEditorOptions<T>) {
  const d = useEditorDraft<T>({ scopeKey: ctx.scopeKey, baseline, validate });
  const flow = useSaveFlow(ctx.scopeKey);
  const guard = useLeaveGuard(d.dirty);
  const retry = useRef<{ patch: Record<string, unknown>; draft: T } | null>(null);
  const seeded = useRef<string | null>(null);

  const seed = ctx.fixture?.variants?.[ctx.fixtureState]?.seed;
  useEffect(() => {
    if (!seed || !d.ready || seeded.current === ctx.scopeKey) return;
    seeded.current = ctx.scopeKey;
    d.patch(seed as Partial<T>);
    if (ctx.fixtureState === "review") flow.openReview();
    // The seed is fixture data applied once per scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, d.ready, ctx.scopeKey]);

  const [firstKey] = Object.keys(d.errors);
  const firstError = firstKey ? (d.errors as Record<string, string>)[firstKey] : undefined;
  const barState = deriveDraftBarState({ phase: flow.phase, dirty: d.dirty, changeCount: d.changes.length, firstError, message: flow.message });
  const rows = useMemo(() => d.changes.map(describe), [d.changes, describe]);

  const apply = useCallback(
    (again = false) =>
      flow.run(async () => {
        if (!d.draft || !d.baseline) return;
        if (!again || !retry.current) {
          const patch = buildPatch ? buildPatch(d.draft, d.baseline, d.changes) : Object.fromEntries(d.changes.map((c) => [c.key, c.after]));
          retry.current = { patch, draft: d.draft };
        }
        await write(retry.current.patch, retry.current.draft);
        d.markSaved(retry.current.draft);
        retry.current = null;
      }),
    [flow, d, buildPatch, write],
  );

  const discard = useCallback(() => {
    retry.current = null;
    d.reset();
    flow.dismiss();
  }, [d, flow]);

  const reviewOpen = flow.phase === "reviewing" || flow.phase === "saving";
  return { ...d, flow, guard, barState, rows, firstError, apply, discard, reviewOpen };
}

export type BrandEditor<T extends Record<string, unknown>> = ReturnType<typeof useBrandEditor<T>>;

export const settingsWriter = (source: BrandSource) => async (patch: Record<string, unknown>) => {
  let ok = false;
  try {
    ok = await source.updateSettings(patch as Partial<DealerSettings>);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error(source.isFixture ? "This is a design fixture: nothing is saved." : "The server did not accept the change. Nothing was saved.");
};

export type { ReactNode };
