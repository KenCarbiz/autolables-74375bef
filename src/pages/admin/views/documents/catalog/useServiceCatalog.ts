import { useCallback, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDealerSettings, type GetReadyService } from "@/contexts/DealerSettingsContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useViewFixture } from "@/lib/admin/dataSource";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useWaveCVariant, type WaveCVariant } from "@/pages/admin/views/publishing/waveCVariant";
import { useTeamMembers } from "@/pages/admin/views/people/useTeamMembers";
import type { TeamMember } from "@/lib/admin/people";

export const CATALOG_VIEW_ID = "service-catalog";
export const CATALOG_FIXTURE_DISABLED = "Design fixture: saving is disabled.";

export interface CatalogFixture {
  services: GetReadyService[];
  photoTasks: string;
  tenantName: string;
}

export interface ServiceCatalog {
  state: "loading" | "ready" | "failed";
  services: GetReadyService[];
  photoTasks: string;
  members: TeamMember[] | null;
  membersState: "loading" | "ready" | "failed" | "no-tenant";
  canEdit: boolean;
  readOnlyReason: string | null;
  isFixture: boolean;
  variant: WaveCVariant;
  tenantName: string | null;
  write: (next: GetReadyService[]) => Promise<{ ok: boolean; error?: string }>;
}

export function useServiceCatalog(): ServiceCatalog {
  const fixture = useViewFixture<CatalogFixture>(CATALOG_VIEW_ID);
  const variant = useWaveCVariant(!!fixture);
  const { settings, updateSettings, loading, serverLoaded, tenantId } = useDealerSettings();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const team = useTeamMembers();

  const liveCanEdit = hasDealerCapability(member?.role, "can_manage_service_settings", isAdmin) || hasDealerCapability(member?.role, "can_manage_settings", isAdmin);
  const canEdit = fixture ? variant !== "readonly" && variant !== "error" : liveCanEdit;

  const services = useMemo<GetReadyService[]>(() => {
    if (fixture) return variant === "empty" ? [] : fixture.services;
    return settings.get_ready_services ?? [];
  }, [fixture, variant, settings.get_ready_services]);

  const write = useCallback(
    async (next: GetReadyService[]) => {
      if (fixture) return { ok: false, error: CATALOG_FIXTURE_DISABLED };
      if (!liveCanEdit) return { ok: false, error: "Your role cannot change the service catalog." };
      if (!serverLoaded || !tenantId) return { ok: false, error: "Settings have not loaded from the server, so nothing can be saved." };
      try {
        const ok = await updateSettings({ get_ready_services: next });
        return ok ? { ok: true } : { ok: false, error: "The server did not accept the change. Your entries are kept." };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "The change could not be saved." };
      }
    },
    [fixture, liveCanEdit, serverLoaded, tenantId, updateSettings],
  );

  const state: ServiceCatalog["state"] = fixture ? (variant === "error" ? "failed" : "ready") : loading ? "loading" : !serverLoaded ? "failed" : "ready";
  return {
    state,
    services: state === "failed" ? [] : services,
    photoTasks: fixture ? fixture.photoTasks : (settings.prep_service_photo_tasks ?? ""),
    members: team.members,
    membersState: team.state,
    canEdit,
    readOnlyReason: fixture ? CATALOG_FIXTURE_DISABLED : liveCanEdit ? null : "The service catalog can be changed by owners, managers and service managers. You can read it here.",
    isFixture: !!fixture,
    variant,
    tenantName: fixture?.tenantName ?? null,
    write,
  };
}
