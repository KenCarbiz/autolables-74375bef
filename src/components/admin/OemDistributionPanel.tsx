import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hostableBrands, type OemDistributionBlock, type OemFranchiseBrand } from "@/lib/oem/distributionGrants";
import { oemDisplayName, resolveOemBrand } from "@/components/brand/OemLogoRegistry";
import { ShieldCheck } from "lucide-react";

// The generated Supabase types are cut from the applied schema, so brand-new
// objects are not in them yet. Same escape the rest of the admin uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// Which manufacturers this store serves OUR COPY of the documents for.
//
// Read-only on purpose. The permission is derived from new-vehicle inventory,
// because new-vehicle franchises are exclusive -- selling new units of a brand
// is what proves the franchise. There is nothing here to switch on, because
// the franchise is not ours to give, and nothing to switch off, because it is
// not the dealer's to refuse.
//
// Every other vehicle links to the manufacturer, including a used car of a
// brand we already host for someone else. Possession is not permission.

const OemDistributionPanel = () => {
  const { tenant } = useEntitlements();
  const tenantId = tenant?.id ?? null;
  const [franchises, setFranchises] = useState<OemFranchiseBrand[] | null>(null);
  const [blocks, setBlocks] = useState<OemDistributionBlock[] | null>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const [{ data: f }, { data: b }] = await Promise.all([
      db.rpc("derive_oem_franchise_brands", { _tenant_id: tenantId }),
      db.from("oem_distribution_blocks").select("tenant_id, brand, reason"),
    ]);
    // Null, not [], when the derivation failed: the policy treats "could not
    // check" as a denial, and an empty array would read as "checked, none".
    setFranchises((f as OemFranchiseBrand[] | null) ?? null);
    setBlocks((b as OemDistributionBlock[] | null) ?? []);
    setLoaded(true);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const hostable = useMemo(
    () => hostableBrands(franchises, blocks, tenantId),
    [franchises, blocks, tenantId],
  );
  const blockedHere = useMemo(() => {
    if (!franchises) return [] as string[];
    const derived = new Set(franchises.map((f) => String(f.brand ?? "").trim().toLowerCase()));
    return (blocks ?? [])
      .map((x) => String(x.brand ?? "").trim().toLowerCase())
      .filter((x) => derived.has(x));
  }, [franchises, blocks]);

  const label = (b: string) => {
    const key = resolveOemBrand(b);
    return key ? oemDisplayName(key) : b.toUpperCase();
  };
  const unitsFor = (b: string) =>
    franchises?.find((f) => String(f.brand ?? "").trim().toLowerCase() === b)?.new_units ?? null;

  return (
    <div id="oem-distribution" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-[18px] h-[18px] text-blue-600" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-foreground">Manufacturer Document Permissions</h3>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            Owner's manuals and brochures are served directly for the brands this store is franchised
            for. Every other vehicle links to the manufacturer's own site instead. This is determined
            automatically from your new-vehicle inventory and is not a setting.
          </p>
        </div>
      </div>

      {!loaded ? (
        <p className="text-[12.5px] text-slate-500 mt-4">Checking…</p>
      ) : franchises === null ? (
        <p className="text-[12.5px] text-slate-500 mt-4">
          Could not confirm franchised brands. Every vehicle links out until this loads.
        </p>
      ) : hostable.length === 0 ? (
        <p className="text-[12.5px] text-slate-500 mt-4">
          No franchised brand detected yet, so every vehicle links to the manufacturer. A brand appears
          here once this store carries new inventory of it.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {hostable.map((b) => (
            <li key={b} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-foreground">{label(b)}</p>
                <p className="text-[11.5px] text-slate-500">
                  {unitsFor(b) != null ? `${unitsFor(b)} new units in inventory` : "Franchised"}
                </p>
              </div>
              <span className="shrink-0 text-[11.5px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-100 rounded-full px-2.5 py-1">
                Served directly
              </span>
            </li>
          ))}
        </ul>
      )}

      {blockedHere.length > 0 && (
        <p className="text-[11.5px] text-slate-500 mt-3">
          {blockedHere.map(label).join(", ")} {blockedHere.length === 1 ? "is" : "are"} link-only at the
          manufacturer&apos;s request.
        </p>
      )}
    </div>
  );
};

export default OemDistributionPanel;
