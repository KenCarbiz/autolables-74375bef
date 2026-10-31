import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useViewFixture } from "@/lib/admin/dataSource";
import { hasDealerCapability, type DealerRole } from "@/lib/permissions/dealerRoleCapabilities";
import { resolvePassportSellingPrice, sellingPriceContextFromSettings, type SellingPriceContext } from "@/lib/passport/sellingPrice";
import { listingModelYear, normalizeEstimatorConfig, serializeEstimatorConfig, type EstimatorConfig } from "@/lib/payment/estimator";
import { tenantIdOf } from "@/pages/admin/views/pricing/pricingData";

// Live data for the payment estimator editor: the selected rooftop's published
// settings, that rooftop's inventory for the preview, and the one write path
// (apply_payment_estimator_settings). Everything is keyed by tenant AND store,
// and the store comes from the existing rooftop selection, never from input.

// Same roles the server accepts (and the fee apply RPC accepts).
export const PAYMENT_SETTINGS_ROLES = new Set(["owner", "admin", "general_manager", "gsm"]);

export interface PublishedEstimator {
  config: EstimatorConfig;
  /** 0 when the store has never applied settings. */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface PreviewVehicle {
  id: string;
  label: string;
  vin: string | null;
  condition: string | null;
  mileage: number | null;
  modelYear: number | null;
  sellingPrice: number | null;
  includesDocFee: boolean;
}

export type LoadState = "loading" | "ready" | "error" | "not_installed";

export interface EstimatorSource {
  state: LoadState;
  error: string | null;
  tenantId: string | null;
  storeId: string | null;
  storeName: string | null;
  otherStores: Array<{ id: string; name: string }>;
  published: PublishedEstimator;
  vehicles: PreviewVehicle[];
  vehiclesState: LoadState;
  vehiclesCheckedAt: number | null;
  priceContext: SellingPriceContext;
  canManage: boolean;
  isFixture: boolean;
  reload: () => void;
  apply: (input: { baseVersion: number; config: EstimatorConfig; requestId: string }) => Promise<ApplyOutcome>;
}

export type ApplyOutcome =
  | { status: "applied"; version: number; replayed: boolean }
  | { status: "conflict"; currentVersion: number | null }
  | { status: "denied"; message: string }
  | { status: "invalid"; message: string }
  | { status: "unchanged" }
  | { status: "failed"; message: string };

export interface EstimatorFixture {
  storeName: string;
  storeId?: string;
  otherStores?: Array<{ id: string; name: string }>;
  published?: { config: unknown; version: number; updatedAt?: string | null };
  vehicles?: PreviewVehicle[];
  canManage?: boolean;
  state?: LoadState;
  priceContext?: SellingPriceContext;
  /** Development fixture only: preload a draft so child screens can be captured. */
  draft?: unknown;
  openRuleId?: string | "new";
  openReview?: boolean;
  section?: string;
}

const EMPTY_PUBLISHED: PublishedEstimator = { config: normalizeEstimatorConfig(null), version: 0, updatedAt: null, updatedBy: null };

const isMissingTable = (e: { code?: string | null; message?: string | null } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42883" || e.code === "PGRST202" || /does not exist|could not find the (table|function)/i.test(e.message ?? ""));

type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string; details?: string } | null }> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as Db;

export function vehicleFromListing(row: Record<string, unknown>, ctx: SellingPriceContext): PreviewVehicle {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const selling = resolvePassportSellingPrice(
    { price: num(row.price), advertised_price_before_doc: num(row.advertised_price_before_doc), doc_fee: num(row.doc_fee), website_sale_price: num(row.website_sale_price) },
    ctx,
  );
  const ymm = typeof row.ymm === "string" ? row.ymm : null;
  return {
    id: String(row.id),
    label: [ymm || "Vehicle", row.trim].filter(Boolean).join(" "),
    vin: typeof row.vin === "string" ? row.vin : null,
    condition: typeof row.condition === "string" ? row.condition : null,
    mileage: num(row.mileage),
    modelYear: listingModelYear({ ymm }),
    sellingPrice: selling.price,
    includesDocFee: selling.includesDocFee,
  };
}

export function useEstimatorSource(): EstimatorSource {
  const fixture = useViewFixture<EstimatorFixture>("payment-estimator");
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { tenant, currentStore, stores } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = fixture ? null : tenantIdOf(tenant);
  const storeId = fixture ? fixture.storeId ?? "fixture-store" : currentStore?.id ?? null;
  const role = `${member?.role ?? ""}`.trim().toLowerCase();
  const canManage = fixture ? fixture.canManage !== false : (isAdmin || PAYMENT_SETTINGS_ROLES.has(role)) && hasDealerCapability(role as DealerRole, "can_manage_settings", isAdmin);
  const priceContext = useMemo(() => fixture?.priceContext ?? sellingPriceContextFromSettings(settings), [fixture, settings]);
  const live = !fixture && !!tenantId && !!storeId;

  const settingsQ = useQuery({
    queryKey: ["payment-estimator", tenantId, storeId],
    enabled: live,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.from("passport_payment_estimator_settings")
        .select("config, version, updated_at, updated_by").eq("tenant_id", tenantId).eq("store_id", storeId).maybeSingle();
      if (error) throw error;
      if (!data) return EMPTY_PUBLISHED;
      return { config: normalizeEstimatorConfig(data.config), version: Number(data.version) || 0, updatedAt: data.updated_at ?? null, updatedBy: data.updated_by ?? null } as PublishedEstimator;
    },
  });

  const vehiclesQ = useQuery({
    queryKey: ["payment-estimator-vehicles", tenantId, storeId, priceContext],
    enabled: live,
    retry: false,
    queryFn: async () => {
      let q = db.from("vehicle_listings")
        .select("id, vin, ymm, trim, condition, mileage, price, advertised_price_before_doc, doc_fee, website_sale_price, status")
        .eq("tenant_id", tenantId).neq("status", "archived").order("ymm", { ascending: false }).limit(500);
      // The synthesized default rooftop (store id = tenant id) also owns the tenant's listings with no store.
      q = storeId === tenantId ? q.or(`store_id.eq.${storeId},store_id.is.null`) : q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return { at: Date.now(), vehicles: ((data ?? []) as Record<string, unknown>[]).map((r) => vehicleFromListing(r, priceContext)) };
    },
  });

  const reload = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["payment-estimator", tenantId, storeId] });
    void qc.invalidateQueries({ queryKey: ["payment-estimator-vehicles", tenantId, storeId] });
  }, [qc, tenantId, storeId]);

  const apply = useCallback(async ({ baseVersion, config, requestId }: { baseVersion: number; config: EstimatorConfig; requestId: string }): Promise<ApplyOutcome> => {
    if (fixture) return { status: "failed", message: "Design fixture: nothing can be applied." };
    if (!tenantId || !storeId) return { status: "failed", message: "No dealership or store is selected." };
    const { data, error } = await db.rpc("apply_payment_estimator_settings", {
      _tenant_id: tenantId, _store_id: storeId, _base_version: baseVersion, _config: serializeEstimatorConfig(config), _request_id: requestId,
    });
    if (error) {
      const msg = error.message ?? "";
      if (error.code === "40001" || /stale_version/.test(msg)) return { status: "conflict", currentVersion: Number(error.details) || null };
      if (error.code === "42501") return { status: "denied", message: /store_not_in_tenant/.test(msg) ? "This store does not belong to your dealership." : "Your role can't change payment settings." };
      if (/no_change/.test(msg)) return { status: "unchanged" };
      if (/invalid_config/.test(msg)) return { status: "invalid", message: error.details ?? "The server found a problem with these settings." };
      if (isMissingTable(error)) return { status: "failed", message: "The payment settings routine isn't installed yet (pending migration). Nothing was saved." };
      return { status: "failed", message: "The server did not accept the change. Nothing was saved." };
    }
    const res = (data ?? {}) as { version?: number; replayed?: boolean };
    await qc.invalidateQueries({ queryKey: ["payment-estimator", tenantId, storeId] });
    return { status: "applied", version: Number(res.version) || baseVersion + 1, replayed: res.replayed === true };
  }, [fixture, tenantId, storeId, qc]);

  if (fixture) {
    const published = fixture.published
      ? { config: normalizeEstimatorConfig(fixture.published.config), version: fixture.published.version, updatedAt: fixture.published.updatedAt ?? null, updatedBy: null }
      : EMPTY_PUBLISHED;
    return {
      state: fixture.state ?? "ready", error: fixture.state === "error" ? "The settings could not be loaded." : null,
      tenantId: null, storeId, storeName: fixture.storeName, otherStores: fixture.otherStores ?? [],
      published, vehicles: fixture.vehicles ?? [], vehiclesState: "ready", vehiclesCheckedAt: Date.parse("2026-10-31T14:00:00Z"),
      priceContext, canManage, isFixture: true, reload, apply,
    };
  }

  const settingsState: LoadState = !tenantId || !storeId ? "loading"
    : settingsQ.isLoading ? "loading"
    : settingsQ.isError ? (isMissingTable(settingsQ.error as never) ? "not_installed" : "error")
    : "ready";
  return {
    state: settingsState,
    error: settingsQ.isError && !isMissingTable(settingsQ.error as never) ? "The payment settings could not be loaded." : null,
    tenantId, storeId, storeName: currentStore?.name ?? null,
    otherStores: (stores ?? []).filter((s) => s.id !== storeId).map((s) => ({ id: s.id, name: s.name })),
    published: settingsQ.data ?? EMPTY_PUBLISHED,
    vehicles: vehiclesQ.data?.vehicles ?? [],
    vehiclesState: vehiclesQ.isLoading ? "loading" : vehiclesQ.isError ? "error" : "ready",
    vehiclesCheckedAt: vehiclesQ.data?.at ?? null,
    priceContext, canManage, isFixture: false, reload, apply,
  };
}

/** Warn before the tab closes while any store has unsaved estimator changes. */
export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [active]);
}

export function useRequestId(): [string, () => void] {
  const make = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const [id, setId] = useState(make);
  return [id, () => setId(make())];
}
