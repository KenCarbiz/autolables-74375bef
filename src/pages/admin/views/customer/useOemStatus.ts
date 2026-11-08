import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useViewFixture } from "@/lib/admin/dataSource";
import { useFixtureVariant } from "../brand/feeds/useSettingsEditor";
import { useTenant } from "@/contexts/TenantContext";
import { oemDisplayName, resolveOemBrand } from "@/components/brand/OemLogoRegistry";
import { hostableBrands, type OemDistributionBlock, type OemFranchiseBrand } from "@/lib/oem/distributionGrants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type OemState = "loading" | "unknown" | "none" | "ready";

export interface OemBrandStatus { brand: string; label: string; served: boolean; linkOnly: boolean }

export interface OemFixture { franchises: OemFranchiseBrand[] | null; blocks: OemDistributionBlock[]; loading?: boolean }

const labelFor = (b: string) => {
  const key = resolveOemBrand(b);
  return key ? oemDisplayName(key) : b.toUpperCase();
};

/** The server's existing answer about which manufacturers this account may serve copies of. Read only; nothing is derived here. */
export function useOemStatus() {
  const fixture = useViewFixture<OemFixture>("oem");
  const variant = useFixtureVariant(!!fixture);
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const [franchises, setFranchises] = useState<OemFranchiseBrand[] | null>(null);
  const [blocks, setBlocks] = useState<OemDistributionBlock[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [{ data: f }, { data: b }] = await Promise.all([
        db.rpc("derive_oem_franchise_brands", { _tenant_id: tenantId }),
        db.from("oem_distribution_blocks").select("tenant_id, brand, reason"),
      ]);
      setFranchises((f as OemFranchiseBrand[] | null) ?? null);
      setBlocks((b as OemDistributionBlock[] | null) ?? []);
    } catch {
      setFranchises(null);
    }
    setLoaded(true);
  }, [tenantId]);

  useEffect(() => { if (!fixture) void load(); }, [load, fixture]);

  return useMemo(() => {
    const f = fixture ? (variant === "missing" ? null : variant === "none" ? [] : fixture.franchises) : franchises;
    const bl = fixture ? fixture.blocks : blocks;
    const ready = fixture ? !fixture.loading : loaded;
    const id = fixture ? "fixture" : tenantId;
    const state: OemState = !ready ? "loading" : f === null ? "unknown" : f.length === 0 ? "none" : "ready";
    const hostable = new Set(hostableBrands(f, bl, id));
    const all = Array.from(new Set((f ?? []).map((x) => String(x.brand ?? "").trim().toLowerCase()).filter(Boolean))).sort();
    const brands: OemBrandStatus[] = all.map((brand) => ({ brand, label: labelFor(brand), served: hostable.has(brand), linkOnly: !hostable.has(brand) }));
    return { state, brands, reload: load };
  }, [fixture, variant, franchises, blocks, loaded, tenantId, load]);
}
