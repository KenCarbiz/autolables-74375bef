import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useViewFixture } from "@/lib/admin/dataSource";
import { realTenantId } from "@/lib/tenant/realTenantId";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import type { StoredPriceRow } from "@/lib/admin/pricing/feeBasis";

// Reads for the Description Engine screen. Every read is a plain table
// select: opening the screen starts no edge function and no provider call.
// The two writes go through the existing RPCs that re-check role
// server-side: save_description_settings (store disclosure) and
// approve_description_version (approval).

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;
const db = supabase as any;

export interface EngineFact { id: string; label: string; value: string; source: string; status: string }

export interface EngineVehicle {
  id: string;
  label: string;
  vin: string;
  stock: string | null;
  price: StoredPriceRow;
  observed: number | null;
}

export interface EngineVersion {
  id: string;
  createdAt: string;
  characterCount: number | null;
  validationStatus: string;
  policyVersion: string | null;
  manualEdit: boolean;
  approval: string | null;
}

export interface EngineDetail {
  caseId: string | null;
  masterVersionId: string | null;
  vautoText: string | null;
  /** The evidence-backed draft narrative the export is fitted from, when the screen can rebuild it. */
  narrative: string | null;
  facts: EngineFact[];
  versions: EngineVersion[];
}

export interface VoiceHistoryRow { version: string; status: string; createdAt: string; reason: string | null }

export interface EngineFixture {
  storeName: string;
  dealerSettings: Record<string, unknown>;
  descriptionSettings: Row;
  voice: { status: string; version: string | null; tone: string | null; history: VoiceHistoryRow[] };
  vehicles: EngineVehicle[];
  details: Record<string, EngineDetail>;
  canApprove: boolean;
  canConfigure: boolean;
}

const fromListing = (r: Row): EngineVehicle => ({
  id: String(r.id),
  label: [r.ymm, r.trim].filter(Boolean).join(" ") || String(r.vin ?? r.id),
  vin: String(r.vin ?? ""),
  stock: r.stock ?? null,
  price: {
    price: r.price == null ? null : Number(r.price),
    advertisedBeforeDoc: r.advertised_price_before_doc == null ? null : Number(r.advertised_price_before_doc),
    websiteSalePrice: r.website_sale_price == null ? null : Number(r.website_sale_price),
    docFee: r.doc_fee == null ? null : Number(r.doc_fee),
  },
  observed: null,
});

const factsFrom = (snapshot: Row | null): EngineFact[] => {
  const raw = snapshot?.facts_json;
  if (Array.isArray(raw)) {
    return raw.slice(0, 60).map((f: Row, i: number) => ({
      id: String(f.id ?? f.key ?? i), label: String(f.label ?? f.key ?? f.field ?? "Fact"),
      value: String(f.value ?? f.display ?? ""), source: String(f.source ?? f.provider ?? "unknown"), status: String(f.status ?? f.confidence ?? "unknown"),
    }));
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Row).slice(0, 60).map(([k, v]) => ({
      id: k, label: k.replace(/_/g, " "), value: typeof v === "object" ? String((v as Row)?.value ?? JSON.stringify(v)) : String(v),
      source: String((v as Row)?.source ?? "snapshot"), status: String((v as Row)?.status ?? "recorded"),
    }));
  }
  return [];
};

export function useDescriptionEngineSource(requestedVehicleId: string | null) {
  const fixture = useViewFixture<EngineFixture>("description-engine");
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { tenant, currentStore } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = fixture ? null : realTenantId(tenant);
  const live = !fixture && !!tenantId;
  const role = member?.role;

  const settingsQ = useQuery({
    queryKey: ["description-engine-settings", tenantId],
    enabled: live,
    retry: false,
    queryFn: async () => {
      const [ds, voice] = await Promise.all([
        db.from("description_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
        db.from("description_voice_profiles").select("version, status, created_at, change_reason, profile_json")
          .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(25),
      ]);
      if (ds.error) throw ds.error;
      const rows: Row[] = voice.data ?? [];
      const current = rows.find((r) => r.status === "approved") ?? rows[0] ?? null;
      return {
        descriptionSettings: (ds.data ?? {}) as Row,
        voice: {
          status: String(current?.status ?? "none"), version: current?.version ?? null, tone: current?.profile_json?.tone ?? null,
          history: rows.map((r) => ({ version: String(r.version ?? ""), status: String(r.status ?? ""), createdAt: String(r.created_at ?? ""), reason: r.change_reason ?? null })),
        },
      };
    },
  });

  const vehiclesQ = useQuery({
    queryKey: ["description-engine-vehicles", tenantId],
    enabled: live,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.from("vehicle_listings")
        .select("id, vin, ymm, trim, price, advertised_price_before_doc, doc_fee, website_sale_price, stock:mc_attributes->>stock_no")
        .eq("tenant_id", tenantId).in("status", ["draft", "published"]).order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return ((data ?? []) as Row[]).map(fromListing);
    },
  });

  const vehicleId = requestedVehicleId ?? (fixture ? fixture.vehicles[0]?.id : vehiclesQ.data?.[0]?.id) ?? null;

  const detailQ = useQuery({
    queryKey: ["description-engine-detail", tenantId, vehicleId],
    enabled: live && !!vehicleId,
    retry: false,
    queryFn: async (): Promise<EngineDetail> => {
      const { data: caseRow } = await db.from("description_cases").select("id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      if (!caseRow) return { caseId: null, masterVersionId: null, vautoText: null, narrative: null, facts: [], versions: [] };
      const [chans, snap, masters] = await Promise.all([
        db.from("description_channel_versions").select("id, content, created_at, character_count, validation_status, channel_policy_version, manual_edit, master_version_id")
          .eq("description_case_id", caseRow.id).eq("channel", "vauto").order("created_at", { ascending: false }).limit(20),
        db.from("description_fact_snapshots").select("facts_json").eq("description_case_id", caseRow.id).order("created_at", { ascending: false }).limit(1),
        db.from("description_versions").select("id, approval_status").eq("description_case_id", caseRow.id),
      ]);
      const approvals: Record<string, string> = {};
      for (const m of (masters.data ?? []) as Row[]) approvals[m.id] = m.approval_status ?? null;
      const rows: Row[] = chans.data ?? [];
      return {
        caseId: caseRow.id,
        masterVersionId: rows[0]?.master_version_id ?? null,
        vautoText: rows[0]?.content ?? null,
        narrative: null,
        facts: factsFrom(snap.data?.[0] ?? null),
        versions: rows.map((r) => ({ id: r.id, createdAt: r.created_at, characterCount: r.character_count, validationStatus: r.validation_status,
          policyVersion: r.channel_policy_version, manualEdit: !!r.manual_edit, approval: approvals[r.master_version_id] ?? null })),
      };
    },
  });

  const saveDisclosure = useCallback(async (text: string): Promise<{ ok: boolean; error?: string }> => {
    if (fixture) return { ok: false, error: "Design fixture: nothing is saved." };
    if (!tenantId) return { ok: false, error: "No dealership is loaded." };
    const current = settingsQ.data?.descriptionSettings ?? {};
    const { data, error } = await db.rpc("save_description_settings", { p_tenant_id: tenantId, p_settings: { ...current, tenant_id: tenantId, required_legal_text: text } });
    if (error) return { ok: false, error: "The server did not accept the change. Nothing was saved." };
    if (data?.ok === false) return { ok: false, error: data.error === "insufficient_permission" ? "Your role cannot change the store disclosure." : String(data.error) };
    await qc.invalidateQueries({ queryKey: ["description-engine-settings", tenantId] });
    return { ok: true };
  }, [fixture, tenantId, settingsQ.data, qc]);

  const approve = useCallback(async (caseId: string, versionId: string, note: string): Promise<{ ok: boolean; error?: string }> => {
    if (fixture) return { ok: false, error: "Design fixture: nothing is approved." };
    const { data, error } = await db.rpc("approve_description_version", { p_case_id: caseId, p_version_id: versionId, p_approve: true, p_note: note || null });
    if (error) return { ok: false, error: error.message };
    if (data?.ok === false) return { ok: false, error: data.error === "insufficient_permission" ? "Your role cannot approve descriptions." : String(data.error) };
    await qc.invalidateQueries({ queryKey: ["description-engine-detail", tenantId, vehicleId] });
    return { ok: true };
  }, [fixture, tenantId, vehicleId, qc]);

  return useMemo(() => {
    if (fixture) {
      return {
        state: "ready" as const, isFixture: true, vehicleId, storeName: fixture.storeName, dealerSettings: fixture.dealerSettings,
        descriptionSettings: fixture.descriptionSettings, voice: fixture.voice, vehicles: fixture.vehicles,
        detail: vehicleId ? fixture.details[vehicleId] ?? null : null, detailLoading: false,
        canApprove: fixture.canApprove, canConfigure: fixture.canConfigure, saveDisclosure, approve,
      };
    }
    return {
      state: (settingsQ.isError ? "error" : !live || settingsQ.isLoading ? "loading" : "ready") as "error" | "loading" | "ready",
      isFixture: false,
      vehicleId,
      storeName: currentStore?.name ?? null,
      dealerSettings: settings as unknown as Record<string, unknown>,
      descriptionSettings: settingsQ.data?.descriptionSettings ?? {},
      voice: settingsQ.data?.voice ?? { status: "none", version: null, tone: null, history: [] },
      vehicles: vehiclesQ.data ?? [],
      detail: detailQ.data ?? null,
      detailLoading: detailQ.isLoading && !!vehicleId,
      canApprove: hasDealerCapability(role, "can_approve_passport_proof", isAdmin),
      canConfigure: hasDealerCapability(role, "can_manage_settings", isAdmin),
      saveDisclosure, approve,
    };
  }, [fixture, vehicleId, settingsQ.isError, settingsQ.isLoading, settingsQ.data, live, currentStore?.name, settings, vehiclesQ.data, detailQ.data, detailQ.isLoading, role, isAdmin, saveDisclosure, approve]);
}
