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
import {
  decideVautoExport, rulesFor, type BlockReason, type EvidenceState, type PriceBreakdown, type SegmentCounts, type StoreDisclosure,
} from "@/lib/description/vautoExport";

// Reads for the Description Engine screen. Every read is a plain table
// select: opening the screen starts no edge function and no provider call.
// Disclosure proposals go through propose_description_disclosure; the vAuto
// check, approval and export go through the description-export function,
// which decides on the server. Both are proposed and not yet deployed, so the
// screen reports "not installed" instead of approving anything locally.

// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;
const db = supabase as any;

export interface EngineFact { id: string; label: string; value: string; source: string; status: string }

export interface EngineVehicle {
  id: string;
  label: string;
  vin: string;
  stock: string | null;
  storeId: string | null;
  price: StoredPriceRow;
  observed: number | null;
}

export interface EngineStore { id: string; name: string; state: string | null; overridesVersion: number | null; overrides: Row }

export interface EngineDisclosure extends StoreDisclosure { id: string; versionNumber: number }

export interface EngineChannelVersion { id: string; channel: string; content: string; characterCount: number | null; validationStatus: string }

export interface ServerCheck {
  checkId: string | null;
  ok: boolean;
  reasons: BlockReason[];
  sqlBlockers: string[];
  counts: SegmentCounts | null;
  breakdown: PriceBreakdown | null;
  renderedDisclosure: string;
  simulated: boolean;
}

export type GateResult<T> = { ok: true; value: T } | { ok: false; error: string };

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
  vautoChannelVersionId: string | null;
  vautoText: string | null;
  /** The evidence-backed draft narrative the export is fitted from, when the screen can rebuild it. */
  narrative: string | null;
  facts: EngineFact[];
  versions: EngineVersion[];
  channels: EngineChannelVersion[];
  evidence: EvidenceState;
  exportApproved: boolean;
}

export interface VoiceHistoryRow { version: string; status: string; createdAt: string; reason: string | null }

export interface EngineFixture {
  storeName: string;
  dealerSettings: Record<string, unknown>;
  descriptionSettings: Row;
  voice: { status: string; version: string | null; tone: string | null; history: VoiceHistoryRow[] };
  vehicles: EngineVehicle[];
  details: Record<string, EngineDetail>;
  stores: EngineStore[];
  disclosures: EngineDisclosure[];
  canApprove: boolean;
  canConfigure: boolean;
}

const fromListing = (r: Row): EngineVehicle => ({
  id: String(r.id),
  label: [r.ymm, r.trim].filter(Boolean).join(" ") || String(r.vin ?? r.id),
  vin: String(r.vin ?? ""),
  stock: r.stock ?? null,
  storeId: r.owning_store_id ?? null,
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

const MISSING = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
const missingTable = (e: Row | null) => !!e && MISSING.has(String(e.code));

const toDisclosure = (r: Row): EngineDisclosure => ({
  id: String(r.id), storeId: r.store_id ?? null, basis: r.basis, template: String(r.template ?? ""), version: String(r.version), versionNumber: Number(r.version) || 0,
  status: r.status, legalReviewedBy: r.legal_reviewed_by ?? null, legalReviewedAt: r.legal_reviewed_at ?? null, legalReference: r.legal_reference ?? null,
  plainTextFormatAccepted: !!r.plain_text_format_accepted, approvedBy: r.approved_by ?? null, approvedAt: r.approved_at ?? null,
});

/** The disclosure that governs a store: its own newest row, else the dealership-wide one. Approved wins over pending. */
export function disclosureForStore(all: EngineDisclosure[], storeId: string | null, basis: string): { approved: EngineDisclosure | null; pending: EngineDisclosure | null; inherited: boolean } {
  const pick = (sid: string | null) => {
    const rows = all.filter((d) => d.storeId === sid && d.basis === basis).sort((a, b) => b.versionNumber - a.versionNumber);
    return { approved: rows.find((d) => d.status === "approved") ?? null, pending: rows.find((d) => d.status === "pending_legal_review" || d.status === "draft") ?? null };
  };
  const own = pick(storeId);
  if (own.approved || own.pending || storeId == null) return { ...own, inherited: false };
  return { ...pick(null), inherited: true };
}

const fnError = async (error: Row): Promise<string> => {
  try { const b = await error?.context?.json?.(); if (b?.error) return String(b.error); } catch { /* body not JSON */ }
  return String(error?.message ?? "The export service did not answer.");
};

export function useDescriptionEngineSource(requestedVehicleId: string | null, requestedStoreId: string | null = null) {
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
      const [ds, voice, stores, storeSettings, disclosures] = await Promise.all([
        db.from("description_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
        db.from("description_voice_profiles").select("version, status, created_at, change_reason, profile_json")
          .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(25),
        db.from("dealer_stores").select("id, display_name, state").eq("tenant_id", tenantId).order("display_name"),
        db.from("description_store_settings").select("store_id, version, overrides").eq("tenant_id", tenantId),
        db.from("description_store_disclosures").select("*").eq("tenant_id", tenantId).order("version", { ascending: false }),
      ]);
      if (ds.error) throw ds.error;
      const overrides = new Map<string, Row>(((storeSettings.error ? [] : storeSettings.data) ?? []).map((r: Row) => [String(r.store_id), r]));
      const rows: Row[] = voice.data ?? [];
      const current = rows.find((r) => r.status === "approved") ?? rows[0] ?? null;
      return {
        storeSettingsInstalled: !missingTable(storeSettings.error),
        gateInstalled: !missingTable(disclosures.error),
        stores: ((stores.error ? [] : stores.data) ?? []).map((r: Row): EngineStore => ({
          id: String(r.id), name: String(r.display_name ?? r.id), state: r.state ?? null,
          overridesVersion: overrides.get(String(r.id))?.version ?? null, overrides: overrides.get(String(r.id))?.overrides ?? {},
        })),
        disclosures: ((disclosures.error ? [] : disclosures.data) ?? []).map(toDisclosure),
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
        .select("id, vin, ymm, trim, price, advertised_price_before_doc, doc_fee, website_sale_price, owning_store_id, stock:mc_attributes->>stock_no")
        .eq("tenant_id", tenantId).in("status", ["draft", "published"]).order("updated_at", { ascending: false }).limit(200);
      if (error) throw error;
      return ((data ?? []) as Row[]).map(fromListing);
    },
  });

  const allVehicles: EngineVehicle[] = fixture ? fixture.vehicles : vehiclesQ.data ?? [];
  const stores: EngineStore[] = fixture ? fixture.stores : settingsQ.data?.stores ?? [];
  const storeId = requestedStoreId && stores.some((st) => st.id === requestedStoreId) ? requestedStoreId : stores[0]?.id ?? null;
  const vehicles = storeId ? allVehicles.filter((v) => v.storeId === storeId) : allVehicles;
  const vehicleId = (requestedVehicleId && vehicles.some((v) => v.id === requestedVehicleId) ? requestedVehicleId : vehicles[0]?.id) ?? null;

  const detailQ = useQuery({
    queryKey: ["description-engine-detail", tenantId, vehicleId],
    enabled: live && !!vehicleId,
    retry: false,
    queryFn: async (): Promise<EngineDetail> => {
      const { data: caseRow } = await db.from("description_cases").select("id").eq("tenant_id", tenantId).eq("vehicle_id", vehicleId).maybeSingle();
      const none: EvidenceState = { factSnapshot: false, openBlockingExceptions: 0, openBlockingFindings: 0, potentiallyStale: false };
      if (!caseRow) return { caseId: null, masterVersionId: null, vautoChannelVersionId: null, vautoText: null, narrative: null, facts: [], versions: [], channels: [], evidence: none, exportApproved: false };
      const [chans, snap, masters, exc, find, caseState] = await Promise.all([
        db.from("description_channel_versions").select("id, content, created_at, character_count, validation_status, channel_policy_version, manual_edit, master_version_id, potentially_stale")
          .eq("description_case_id", caseRow.id).eq("channel", "vauto").order("created_at", { ascending: false }).limit(20),
        db.from("description_fact_snapshots").select("facts_json").eq("description_case_id", caseRow.id).order("created_at", { ascending: false }).limit(1),
        db.from("description_versions").select("id, approval_status").eq("description_case_id", caseRow.id),
        db.from("description_exceptions").select("id", { count: "exact", head: true }).eq("description_case_id", caseRow.id).eq("blocking", true).in("status", ["open", "in_progress"]),
        db.from("description_validation_results").select("id", { count: "exact", head: true }).eq("description_case_id", caseRow.id).eq("blocking", true).eq("status", "open"),
        db.from("description_cases").select("potentially_stale").eq("id", caseRow.id).maybeSingle(),
      ]);
      const approvals: Record<string, string> = {};
      for (const m of (masters.data ?? []) as Row[]) approvals[m.id] = m.approval_status ?? null;
      const rows: Row[] = chans.data ?? [];
      const latestMaster = rows[0]?.master_version_id ?? null;
      const [siblings, approval] = await Promise.all([
        latestMaster
          ? db.from("description_channel_versions").select("id, channel, content, character_count, validation_status").eq("master_version_id", latestMaster)
          : Promise.resolve({ data: [] }),
        rows[0]?.id
          ? db.from("description_export_approvals").select("id").eq("channel_version_id", rows[0].id).is("revoked_at", null).limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      return {
        caseId: caseRow.id,
        masterVersionId: latestMaster,
        vautoChannelVersionId: rows[0]?.id ?? null,
        vautoText: rows[0]?.content ?? null,
        narrative: null,
        channels: ((siblings.data ?? []) as Row[]).map((r) => ({ id: String(r.id), channel: String(r.channel), content: String(r.content ?? ""),
          characterCount: r.character_count ?? null, validationStatus: String(r.validation_status ?? "pending") })),
        evidence: { factSnapshot: (snap.data ?? []).length > 0, openBlockingExceptions: exc.count ?? 0, openBlockingFindings: find.count ?? 0,
          potentiallyStale: !!caseState.data?.potentially_stale || !!rows[0]?.potentially_stale },
        exportApproved: ((approval as Row).data ?? []).length > 0,
        facts: factsFrom(snap.data?.[0] ?? null),
        versions: rows.map((r) => ({ id: r.id, createdAt: r.created_at, characterCount: r.character_count, validationStatus: r.validation_status,
          policyVersion: r.channel_policy_version, manualEdit: !!r.manual_edit, approval: approvals[r.master_version_id] ?? null })),
      };
    },
  });

  const proposeDisclosure = useCallback(async (forStore: string | null, basis: "includes_fee" | "before_fee", template: string): Promise<GateResult<string>> => {
    if (fixture) return { ok: false, error: "Synthetic example: nothing is submitted." };
    if (!tenantId) return { ok: false, error: "No dealership is loaded." };
    const { data, error } = await db.rpc("propose_description_disclosure", { _tenant_id: tenantId, _store_id: forStore, _basis: basis, _template: template });
    if (error) return { ok: false, error: missingTable(error) ? "The disclosure review step is not installed yet. Nothing was submitted." : error.code === "42501" ? "Your role cannot propose store disclosures." : "The server did not accept the proposal. Nothing was submitted." };
    await qc.invalidateQueries({ queryKey: ["description-engine-settings", tenantId] });
    return { ok: true, value: String(data) };
  }, [fixture, tenantId, qc]);

  const fixtureDetail = fixture && vehicleId ? fixture.details[vehicleId] ?? null : null;
  const serverCheck = useCallback(async (channelVersionId: string | null): Promise<GateResult<ServerCheck>> => {
    if (fixture) {
      const v = fixture.vehicles.find((x) => x.id === vehicleId) ?? null;
      const store = fixture.stores.find((x) => x.id === v?.storeId) ?? null;
      const gov = disclosureForStore(fixture.disclosures, v?.storeId ?? null, "includes_fee");
      const d = decideVautoExport({
        content: fixtureDetail?.vautoText ?? "", cta: String(fixture.descriptionSettings.cta_template ?? "") || null, settings: fixture.dealerSettings,
        row: v?.price ?? null, observed: v?.observed ?? null, disclosure: gov.approved ?? gov.pending, rules: rulesFor(store?.state),
        evidence: fixtureDetail?.evidence ?? null, authorized: fixture.canApprove,
      });
      return { ok: true, value: { checkId: null, ok: d.ok, reasons: d.reasons, sqlBlockers: [], counts: d.counts, breakdown: d.breakdown, renderedDisclosure: d.renderedDisclosure, simulated: true } };
    }
    if (!channelVersionId) return { ok: false, error: "No stored vAuto version to check." };
    const { data, error } = await supabase.functions.invoke("description-export", { body: { action: "check", channel_version_id: channelVersionId } });
    if (error) return { ok: false, error: await fnError(error as Row) };
    const r = data as Row;
    return { ok: true, value: { checkId: r.check_id ?? null, ok: r.ok === true, reasons: r.reasons ?? [], sqlBlockers: r.sql_blockers ?? [], counts: r.counts ?? null,
      breakdown: r.breakdown ?? null, renderedDisclosure: String(r.rendered_disclosure ?? ""), simulated: false } };
  }, [fixture, vehicleId, fixtureDetail]);

  const serverApprove = useCallback(async (checkId: string, note: string): Promise<GateResult<string>> => {
    if (fixture) return { ok: false, error: "Synthetic example: nothing is approved." };
    const { data, error } = await supabase.functions.invoke("description-export", { body: { action: "approve", check_id: checkId, note: note || null } });
    if (error) return { ok: false, error: await fnError(error as Row) };
    await qc.invalidateQueries({ queryKey: ["description-engine-detail", tenantId, vehicleId] });
    return { ok: true, value: String((data as Row)?.approval_id ?? "") };
  }, [fixture, tenantId, vehicleId, qc]);

  const serverExport = useCallback(async (channelVersionId: string): Promise<GateResult<string>> => {
    if (fixture) return { ok: false, error: "Synthetic example: nothing is exported." };
    const { data, error } = await supabase.functions.invoke("description-export", { body: { action: "export", channel_version_id: channelVersionId } });
    if (error) return { ok: false, error: await fnError(error as Row) };
    return { ok: true, value: String((data as Row)?.content ?? "") };
  }, [fixture]);

  return useMemo(() => {
    if (fixture) {
      return {
        state: "ready" as const, isFixture: true, vehicleId, storeName: stores.find((st) => st.id === storeId)?.name ?? fixture.storeName, dealerSettings: fixture.dealerSettings,
        descriptionSettings: fixture.descriptionSettings, voice: fixture.voice, vehicles, stores, storeId, disclosures: fixture.disclosures,
        gateInstalled: true, storeSettingsInstalled: true,
        detail: fixtureDetail, detailLoading: false,
        canApprove: fixture.canApprove, canConfigure: fixture.canConfigure, proposeDisclosure, serverCheck, serverApprove, serverExport,
      };
    }
    return {
      state: (settingsQ.isError ? "error" : !live || settingsQ.isLoading ? "loading" : "ready") as "error" | "loading" | "ready",
      isFixture: false,
      vehicleId,
      storeName: stores.find((st) => st.id === storeId)?.name ?? currentStore?.name ?? null,
      dealerSettings: settings as unknown as Record<string, unknown>,
      descriptionSettings: settingsQ.data?.descriptionSettings ?? {},
      voice: settingsQ.data?.voice ?? { status: "none", version: null, tone: null, history: [] },
      vehicles, stores, storeId,
      disclosures: settingsQ.data?.disclosures ?? [],
      gateInstalled: settingsQ.data?.gateInstalled ?? false,
      storeSettingsInstalled: settingsQ.data?.storeSettingsInstalled ?? false,
      detail: detailQ.data ?? null,
      detailLoading: detailQ.isLoading && !!vehicleId,
      canApprove: hasDealerCapability(role, "can_approve_passport_proof", isAdmin),
      canConfigure: hasDealerCapability(role, "can_manage_settings", isAdmin),
      proposeDisclosure, serverCheck, serverApprove, serverExport,
    };
  }, [fixture, vehicleId, vehicles, stores, storeId, fixtureDetail, settingsQ.isError, settingsQ.isLoading, settingsQ.data, live, currentStore?.name, settings, detailQ.data, detailQ.isLoading, role, isAdmin, proposeDisclosure, serverCheck, serverApprove, serverExport]);
}
