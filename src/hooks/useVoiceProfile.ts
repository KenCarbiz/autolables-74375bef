import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import {
  resolveVoiceProfile, computeVoiceProfileVersion, draftFromProfile, draftAsProfile,
  draftToProfileJson, type VoiceProfile, type VoiceProfileDraft,
} from "@/lib/description/voiceProfile";

// Data access for the dealership voice profile. Every write goes through
// save_description_voice_profile, which re-checks membership and role
// server-side — the UI gate below only decides what to render.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;

const RPC_ERROR_COPY: Record<string, string> = {
  not_authenticated: "Your session expired. Sign in again and retry.",
  not_a_member: "Your account is not a member of this dealership.",
  insufficient_permission: "Your role cannot change the voice profile. Ask an owner, admin or compliance user.",
};

export interface VoiceProfileState {
  /** The approved profile, or the latest draft when nothing is approved. */
  profile: VoiceProfile | null;
  /** Editable copy of the above. */
  draft: VoiceProfileDraft | null;
  /** The saved draft, for the change summary. */
  baseline: VoiceProfileDraft | null;
  history: Row[];
  loading: boolean;
  error: string | null;
}

export function useVoiceProfilePermissions() {
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const role = member?.role;
  return {
    canView: true,
    // Redefining what the store may claim about itself is deliberately
    // narrower than approving a single description.
    canEdit: hasDealerCapability(role, "can_manage_settings", isAdmin),
    canApprove: hasDealerCapability(role, "can_manage_settings", isAdmin),
  };
}

export function useVoiceProfile() {
  const { tenant } = useTenant();
  const [state, setState] = useState<VoiceProfileState>({
    profile: null, draft: null, baseline: null, history: [], loading: true, error: null,
  });
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [rowsRes, settingsRes] = await Promise.all([
        (supabase as any).from("description_voice_profiles")
          .select("*").eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false }).limit(25),
        (supabase as any).from("description_settings")
          .select("*").eq("tenant_id", tenant.id).maybeSingle(),
      ]);
      if (rowsRes.error) throw rowsRes.error;

      const rows: Row[] = rowsRes.data || [];
      // The approved row governs generation; a newer draft is what the dealer
      // is still working on. Show the draft when one exists so edits are not
      // silently discarded, but the status badge always tells them which.
      const approved = rows.find((r) => r.status === "approved") || null;
      const latestDraft = rows.find((r) => r.status === "draft") || null;
      const current = latestDraft || approved;

      const profile = resolveVoiceProfile(
        tenant.id, current, settingsRes.data || {}, null,
      );
      const draft = draftFromProfile(profile);
      setState({
        profile, draft, baseline: draft, history: rows, loading: false, error: null,
      });
    } catch (e: any) {
      setState((s) => ({ ...s, loading: false, error: e?.message || "Could not load the voice profile." }));
    }
  }, [tenant?.id]);

  useEffect(() => { load(); }, [load]);

  // Keep the displayed version in step with the edits, using the same hash the
  // orchestrator computes so the two never disagree.
  useEffect(() => {
    let cancelled = false;
    if (!state.draft || !state.profile) { setVersion(null); return; }
    computeVoiceProfileVersion(draftAsProfile(state.draft, state.profile))
      .then((v) => { if (!cancelled) setVersion(v); })
      .catch(() => { if (!cancelled) setVersion(null); });
    return () => { cancelled = true; };
  }, [state.draft, state.profile]);

  const setDraft = useCallback((patch: Partial<VoiceProfileDraft>) => {
    setState((s) => (s.draft ? { ...s, draft: { ...s.draft, ...patch } } : s));
  }, []);

  const save = useCallback(async (approve: boolean, reason: string): Promise<
    { ok: true; status: string; version: string } | { ok: false; error: string }
  > => {
    if (!tenant?.id || !state.draft || !state.profile) {
      return { ok: false, error: "No dealership loaded." };
    }
    setSaving(true);
    try {
      const nextVersion = await computeVoiceProfileVersion(
        draftAsProfile(state.draft, state.profile));
      const { data, error } = await (supabase as any).rpc("save_description_voice_profile", {
        p_tenant_id: tenant.id,
        p_profile: draftToProfileJson(state.draft),
        p_version: nextVersion,
        p_approve: approve,
        p_reason: reason || null,
      });
      if (error) throw error;
      if (!data?.ok) {
        const code = String(data?.error || "save_failed");
        return { ok: false, error: RPC_ERROR_COPY[code] || code };
      }
      await load();
      return { ok: true, status: String(data.status), version: String(data.version) };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Could not save the voice profile." };
    } finally {
      setSaving(false);
    }
  }, [tenant?.id, state.draft, state.profile, load]);

  return { ...state, version, saving, setDraft, save, reload: load };
}
