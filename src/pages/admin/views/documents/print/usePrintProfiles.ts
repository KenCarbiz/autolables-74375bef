import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { upsertPrintCalibration } from "@/lib/stickerStudio/useDealerPrintSettings";
import type { PrintCalibration } from "@/lib/stickerStudio/printConfig";
import { profileFromRow, type PrintProfile, type PrintProfileRow } from "@/lib/admin/printWizard";

export const PRINT_VIEW_ID = "print-profiles";

export type PrintVariant = "default" | "empty" | "invalid" | "readonly" | "error" | "blocked";
const VARIANTS: readonly PrintVariant[] = ["default", "empty", "invalid", "readonly", "error", "blocked"];

export interface PrintRooftop { id: string; name: string; city?: string; state?: string }

export interface PrintFixture {
  tenantName: string;
  rooftops: PrintRooftop[];
  rows: PrintProfileRow[];
  now?: string;
}

export interface PrintProfiles {
  state: "loading" | "ready" | "failed" | "no-tenant";
  error: string | null;
  profiles: PrintProfile[];
  rooftops: PrintRooftop[];
  tenantName: string | null;
  isFixture: boolean;
  variant: PrintVariant;
  canEdit: boolean;
  readOnlyReason: string | null;
  rooftopLabel: (locationId: string | null) => string;
  save: (locationId: string | null, cal: PrintCalibration) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  reload: () => void;
}

type Result = { data: PrintProfileRow[] | null; error: { message?: string } | null };
type DeleteResult = { error: { message?: string } | null };
interface Client {
  from: (t: string) => {
    select: (c: string) => { eq: (c: string, v: string) => PromiseLike<Result> };
    delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => PromiseLike<DeleteResult> } };
  };
}

const rowFromCalibration = (cal: PrintCalibration) => ({
  label_mode: cal.labelMode,
  x_offset_inches: cal.xOffsetIn,
  y_offset_inches: cal.yOffsetIn,
  scale_percentage: cal.scalePct,
  printer_name: cal.printerName ?? null,
  top_safe_margin_inches: cal.topSafeMarginIn,
  left_safe_margin_inches: cal.leftSafeMarginIn,
  show_crop_marks: cal.showCropMarks,
  show_safe_area: cal.showSafeArea,
});

/** After an accepted write, shows the saved values at once; only the written scope's row changes. */
export function patchRows(rows: PrintProfileRow[], locationId: string | null, cal: PrintCalibration, nowIso: string): PrintProfileRow[] {
  const patch = { ...rowFromCalibration(cal), updated_at: nowIso };
  if (rows.some((r) => (r.location_id ?? null) === locationId)) return rows.map((r) => ((r.location_id ?? null) === locationId ? { ...r, ...patch } : r));
  return [...rows, { id: `new-${locationId ?? "default"}`, location_id: locationId, ...patch }];
}

export const FIXTURE_DISABLED = "Design fixture: saving is disabled.";

export function usePrintProfiles(): PrintProfiles {
  const fixture = useViewFixture<PrintFixture>(PRINT_VIEW_ID);
  const { search } = useLocation();
  const raw = new URLSearchParams(search).get("state") as PrintVariant | null;
  const variant: PrintVariant = fixture && raw && VARIANTS.includes(raw) ? raw : "default";
  const { tenant, stores } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const [rows, setRows] = useState<PrintProfileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    setRows(null);
    setError(null);
  }, [tenantId]);

  useEffect(() => {
    if (fixture || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await (supabase as unknown as Client).from("dealer_print_settings").select("*").eq("tenant_id", tenantId);
        if (cancelled) return;
        if (res.error) setError(res.error.message || "The profiles could not be read.");
        else setRows(res.data ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "The profiles could not be read.");
      }
    })();
    return () => { cancelled = true; };
  }, [fixture, tenantId, generation]);

  const rooftops = useMemo<PrintRooftop[]>(
    () => (fixture ? fixture.rooftops : (stores ?? []).map((s) => ({ id: s.id, name: s.name, city: s.city, state: s.state }))),
    [fixture, stores],
  );

  const fixtureRows = useMemo(() => {
    if (!fixture) return null;
    if (variant === "empty") return [];
    return fixture.rows;
  }, [fixture, variant]);

  const source = fixtureRows ?? rows;
  const profiles = useMemo(() => (source ?? []).map(profileFromRow).sort((a, b) => Number(a.locationId !== null) - Number(b.locationId !== null)), [source]);

  // dealer_print_settings is writable by any accepted member of the tenant (row-level security), so the page adds no role gate.
  const canEdit = fixture ? variant !== "readonly" && variant !== "error" : !!tenantId;
  const readOnlyReason = fixture ? FIXTURE_DISABLED : null;

  const rooftopLabel = useCallback(
    (locationId: string | null) => (locationId === null ? (fixture?.tenantName ?? tenant?.name ?? "Dealership default") : rooftops.find((r) => r.id === locationId)?.name ?? "Rooftop not found"),
    [fixture, tenant?.name, rooftops],
  );

  const save = useCallback(
    async (locationId: string | null, cal: PrintCalibration) => {
      if (fixture) return { ok: false, error: FIXTURE_DISABLED };
      if (!tenantId) return { ok: false, error: "no_tenant" };
      const r = await upsertPrintCalibration(tenantId, locationId, cal);
      if (r.ok) {
        setRows((cur) => patchRows(cur ?? [], locationId, cal, new Date().toISOString()));
        setGeneration((g) => g + 1);
      }
      return r;
    },
    [fixture, tenantId],
  );

  const remove = useCallback(
    async (id: string) => {
      if (fixture) return { ok: false, error: FIXTURE_DISABLED };
      if (profiles.find((p) => p.id === id)?.locationId === null) return { ok: false, error: "The dealership default profile cannot be deleted. Reset its alignment instead." };
      if (!tenantId) return { ok: false, error: "no_tenant" };
      try {
        const res = await (supabase as unknown as Client).from("dealer_print_settings").delete().eq("id", id).eq("tenant_id", tenantId);
        if (res.error) return { ok: false, error: res.error.message };
        setGeneration((g) => g + 1);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "delete_failed" };
      }
    },
    [fixture, tenantId, profiles],
  );

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  const state: PrintProfiles["state"] = fixture ? (variant === "error" ? "failed" : "ready") : !tenantId ? "no-tenant" : error ? "failed" : rows === null ? "loading" : "ready";
  return {
    state,
    error: fixture ? (variant === "error" ? "The printer profiles could not be read from the server." : null) : error,
    profiles: state === "failed" ? [] : profiles,
    rooftops,
    tenantName: fixture?.tenantName ?? (tenant?.name && tenant.id !== "house" ? tenant.name : null),
    isFixture: !!fixture,
    variant,
    canEdit,
    readOnlyReason,
    rooftopLabel,
    save,
    remove,
    reload,
  };
}
