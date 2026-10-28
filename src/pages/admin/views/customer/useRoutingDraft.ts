import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasAnyDealerCapability, type DealerRole } from "@/lib/permissions/dealerRoleCapabilities";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { canApply, diffFields, initialReviewApply, isUnchanged, newIdempotencyKey, reviewApplyReducer } from "@/lib/admin/reviewApply";
import { deriveRoutingReadiness } from "@/lib/admin/effectivePolicy";
import {
  namedAgents,
  routingApplyGate,
  routingChangeRows,
  routingSliceFrom,
  validateRoutingDraft,
  type RoutingDraftSlice,
} from "@/lib/admin/routingDraft";
import type { CustomerPassportContactSettings, PassportAgent } from "@/lib/passportRouting";

// One draft for Contact & Routing and the Escalation child. Both edit the same
// two settings keys through the same Review & Apply state machine; the only
// writer is merge_dealer_settings via updateSettings, and it runs only from
// apply(). Opening either screen, editing, or reviewing writes nothing.

export interface RoutingStore {
  id: string;
  name: string;
}

export interface RoutingFixture {
  routing: unknown;
  agents: PassportAgent[];
  stores: RoutingStore[];
}

export type ReviewOutcome = "reviewing" | "invalid" | "conflict" | "unchanged";

type RoutingPatch = Partial<CustomerPassportContactSettings> | ((r: CustomerPassportContactSettings) => Partial<CustomerPassportContactSettings>);

export function useRoutingDraft() {
  const fixture = useViewFixture<RoutingFixture>("routing");
  const now = useAdminNow();
  const { settings, updateSettings, loading } = useDealerSettings();
  const { tenant, stores: liveStores, currentStore } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();

  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const current = useMemo<RoutingDraftSlice>(
    () => (fixture ? routingSliceFrom(fixture.routing, fixture.agents) : routingSliceFrom(settings.passport_contact_routing, settings.passport_agents)),
    [fixture, settings.passport_contact_routing, settings.passport_agents],
  );
  const currentRef = useRef(current);
  currentRef.current = current;

  const [state, dispatch] = useReducer(reviewApplyReducer<RoutingDraftSlice>, current, initialReviewApply<RoutingDraftSlice>);
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  // The baseline follows the load, not every settings change: a change made
  // elsewhere surfaces as a conflict at review time instead of silently
  // replacing what the person is editing.
  const baselineKey = fixture ? "fixture" : `${tenantId ?? "none"}:${loading ? "loading" : "ready"}`;
  const lastBaseline = useRef(baselineKey);
  useEffect(() => {
    if (lastBaseline.current === baselineKey) return;
    lastBaseline.current = baselineKey;
    dispatch({ type: "reset", original: currentRef.current });
  }, [baselineKey]);

  const edit = useCallback((next: RoutingDraftSlice) => {
    draftRef.current = next;
    dispatch({ type: "edit", draft: next });
  }, []);

  const patchRouting = useCallback((p: RoutingPatch) => {
    const d = draftRef.current;
    const patch = typeof p === "function" ? p(d.routing) : p;
    edit({ ...d, routing: { ...d.routing, ...patch } });
  }, [edit]);

  const setAgents = useCallback((fn: (agents: PassportAgent[]) => PassportAgent[]) => {
    const d = draftRef.current;
    edit({ ...d, agents: fn(d.agents) });
  }, [edit]);

  const stores: RoutingStore[] = useMemo(
    () => (fixture ? fixture.stores : liveStores.map((s) => ({ id: s.id, name: s.name }))),
    [fixture, liveStores],
  );
  const storeCount = Math.max(1, stores.length);
  const currentStoreName = fixture ? fixture.stores[0]?.name ?? "This rooftop" : currentStore?.name ?? stores[0]?.name ?? tenant?.name ?? "This rooftop";

  const role = member?.role as DealerRole | undefined;
  const canEdit = !!fixture || isAdmin || (!!role && hasAnyDealerCapability(role, ["can_manage_settings"]));

  const dirty = !isUnchanged(state.draft, state.original);
  const gate = useMemo(() => routingApplyGate(state.original, state.draft), [state.original, state.draft]);
  const readiness = useMemo(() => deriveRoutingReadiness(state.draft.routing, state.draft.agents), [state.draft]);
  const changeRows = useMemo(() => routingChangeRows(state.original, state.draft), [state.original, state.draft]);

  const changedElsewhere = useCallback((): string[] => {
    if (fixture) return [];
    const live = currentRef.current;
    const fields = diffFields(
      state.original.routing as unknown as Record<string, unknown>,
      live.routing as unknown as Record<string, unknown>,
    ).map((d) => d.field);
    if (!isUnchanged(namedAgents(state.original.agents), namedAgents(live.agents))) fields.push("agents");
    return fields;
  }, [fixture, state.original]);

  const review = useCallback((): ReviewOutcome => {
    const draft = draftRef.current;
    if (isUnchanged(draft, state.original)) return "unchanged";
    const errors = validateRoutingDraft(draft);
    dispatch({ type: "validate", errors });
    if (errors.length) return "invalid";
    const moved = changedElsewhere();
    if (moved.length) {
      dispatch({ type: "conflict", changedFields: moved });
      return "conflict";
    }
    const g = routingApplyGate(state.original, draft);
    dispatch({
      type: "review",
      impact: {
        computedAt: new Date(now).toISOString(),
        version: null,
        counts: { rooftops: storeCount },
        samples: [],
        warnings: [...g.remainingBlockers, ...g.readinessAfter.warnings],
        exclusions: [],
      },
      idempotencyKey: newIdempotencyKey("routing"),
    });
    return "reviewing";
  }, [state.original, changedElsewhere, now, storeCount]);

  const cancelReview = useCallback(() => dispatch({ type: "edit", draft: draftRef.current }), []);
  const discard = useCallback(() => dispatch({ type: "reset", original: currentRef.current }), []);

  const apply = useCallback(async (): Promise<boolean> => {
    const g = canApply(state);
    if (!g.ok) {
      dispatch({ type: "error", message: g.reason ?? "This change cannot be applied." });
      return false;
    }
    if (!gate.ok) {
      dispatch({ type: "error", message: gate.reason ?? "This change cannot be applied." });
      return false;
    }
    if (!canEdit) {
      dispatch({ type: "error", message: "Your role can view routing but cannot change it." });
      return false;
    }
    const moved = changedElsewhere();
    if (moved.length) {
      dispatch({ type: "conflict", changedFields: moved });
      return false;
    }
    dispatch({ type: "apply" });
    if (fixture) {
      dispatch({ type: "result", result: { status: "applied", affected: storeCount, message: "Design fixture: nothing was written." } });
      return true;
    }
    // A writer that throws is a refused save too; the review must leave "applying".
    let ok = false;
    try {
      ok = await updateSettings({
        passport_contact_routing: state.draft.routing,
        passport_agents: namedAgents(state.draft.agents),
      });
    } catch {
      ok = false;
    }
    if (ok) dispatch({ type: "result", result: { status: "applied", affected: storeCount, message: "Routing applied. Every consumer reads the new configuration from now on." } });
    else dispatch({ type: "error", message: "The change was not saved. Nothing was applied." });
    return ok;
  }, [state, gate, canEdit, changedElsewhere, fixture, storeCount, updateSettings]);

  return {
    fixture: !!fixture,
    loading: !fixture && loading,
    canEdit,
    now,
    state,
    current,
    draft: state.draft,
    original: state.original,
    dirty,
    gate,
    readiness,
    changeRows,
    stores,
    storeCount,
    currentStoreName,
    patchRouting,
    setAgents,
    review,
    cancelReview,
    discard,
    apply,
  };
}

export type RoutingDraftApi = ReturnType<typeof useRoutingDraft>;
