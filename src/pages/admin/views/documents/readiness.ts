import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { knownCount, type CountValue } from "@/lib/admin/health";
import { LABEL_SLOTS } from "@/lib/labelDefaults";
import { deriveDocumentReadiness, type CalibrationStatus, type ReadinessItem } from "@/lib/admin/documentPolicy";

// Tenant-scoped reads behind the Documents & Service readiness panel. Every
// read is a plain select; nothing here writes, prints or generates.

export type VersionCheck = "ok" | "pending_migration" | "unavailable" | "fixture";

export interface DocumentsReadinessFixture {
  calibration: CalibrationStatus;
  templatesConfigured: CountValue;
  disclosuresMissing: CountValue;
  policyVersion: number | null;
  versionCheck: VersionCheck;
}

export interface PolicyVersionRead {
  version: number | null;
  check: VersionCheck;
}

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

const MISSING_FUNCTION = /42883|PGRST202|could not find the function|does not exist/i;

/** admin_policy_version lands with the S10 authority migration; until then the check is honestly pending. */
export async function readPolicyVersion(tenantId: string): Promise<PolicyVersionRead> {
  try {
    const { data, error } = await (supabase as unknown as RpcClient).rpc("admin_policy_version", { p_tenant_id: tenantId });
    if (error) return { version: null, check: MISSING_FUNCTION.test(`${error.code ?? ""} ${error.message ?? ""}`) ? "pending_migration" : "unavailable" };
    const n = typeof data === "number" ? data : typeof data === "string" ? Number(data) : Number.NaN;
    return Number.isFinite(n) ? { version: n, check: "ok" } : { version: null, check: "unavailable" };
  } catch {
    return { version: null, check: "unavailable" };
  }
}

export async function readActiveVehicleCount(tenantId: string): Promise<CountValue> {
  try {
    const { count, error } = await supabase.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null);
    if (error || count === null || count === undefined) return { kind: "failed" };
    return knownCount(count);
  } catch {
    return { kind: "failed" };
  }
}

async function readCalibration(tenantId: string): Promise<CalibrationStatus> {
  try {
    const { data, error } = await supabase.from("dealer_print_settings").select("updated_at").eq("tenant_id", tenantId).is("location_id", null).maybeSingle();
    if (error) return { kind: "failed" };
    return { kind: "known", saved: !!data, savedAt: data?.updated_at ?? null, testedAt: null };
  } catch {
    return { kind: "failed" };
  }
}

const DISCLOSURE_SCAN_LIMIT = 500;

async function readMissingDisclosures(tenantId: string): Promise<CountValue> {
  try {
    const { data, error } = await supabase.from("products").select("id, disclosure").eq("tenant_id", tenantId).eq("is_active", true).limit(DISCLOSURE_SCAN_LIMIT);
    if (error || !Array.isArray(data)) return { kind: "failed" };
    const missing = data.filter((p) => !(p.disclosure ?? "").trim()).length;
    return knownCount(missing, data.length >= DISCLOSURE_SCAN_LIMIT);
  } catch {
    return { kind: "failed" };
  }
}

export interface DocumentsReadiness {
  items: ReadinessItem[];
  calibration: CalibrationStatus;
  templatesConfigured: CountValue;
  disclosuresMissing: CountValue;
  policyVersion: number | null;
  versionCheck: VersionCheck | null;
  loading: boolean;
  failed: boolean;
}

export function useDocumentsReadiness(): DocumentsReadiness {
  const fixture = useViewFixture<DocumentsReadinessFixture>("documents-readiness");
  const now = useAdminNow();
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const live = useQuery({
    queryKey: ["admin-v2", "documents-readiness", tenantId],
    enabled: !fixture && !!tenantId,
    queryFn: async () => {
      const id = tenantId as string;
      const [calibration, disclosuresMissing, version] = await Promise.all([readCalibration(id), readMissingDisclosures(id), readPolicyVersion(id)]);
      return { calibration, disclosuresMissing, version };
    },
    staleTime: 30_000,
  });

  const templatesConfigured: CountValue = fixture
    ? fixture.templatesConfigured
    : knownCount(LABEL_SLOTS.filter((s) => !!settings.label_defaults?.[s.slot]).length);

  const loading = !fixture && !!tenantId && live.isLoading;
  const failed = !fixture && (!tenantId || live.isError);

  const calibration: CalibrationStatus = fixture ? fixture.calibration : failed ? { kind: "failed" } : live.data ? live.data.calibration : { kind: "loading" };
  const disclosuresMissing: CountValue = fixture ? fixture.disclosuresMissing : failed ? { kind: "failed" } : live.data ? live.data.disclosuresMissing : { kind: "loading" };
  const policyVersion = fixture ? fixture.policyVersion : live.data?.version.version ?? null;
  const versionCheck: VersionCheck | null = fixture ? fixture.versionCheck : live.data?.version.check ?? null;

  const items = deriveDocumentReadiness({ calibration, templatesConfigured, templateSlots: LABEL_SLOTS.length, disclosuresMissing, now });

  return { items, calibration, templatesConfigured, disclosuresMissing, policyVersion, versionCheck, loading, failed };
}
