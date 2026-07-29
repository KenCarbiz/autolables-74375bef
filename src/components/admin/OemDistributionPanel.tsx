import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The generated Supabase types are cut from the applied schema, so a brand-new
// table and its RPCs are not in them yet. Same escape the rest of the admin
// uses for freshly-migrated objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
import { useEntitlements } from "@/hooks/useEntitlements";
import { grantBrandKey, type OemDistributionGrant } from "@/lib/oem/distributionGrants";
import { oemDisplayName, resolveOemBrand } from "@/components/brand/OemLogoRegistry";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Which manufacturers this store may serve OUR COPY of the documents for.
//
// Linking to a brochure or an owner's manual needs no permission. Hosting the
// bytes is redistribution, and that right belongs to the franchised dealer for
// their own brand. Absence of a grant means link-only, which is why nothing
// here defaults to on.
//
// The attestation wording is written by the server (oem_attestation_text), not
// posted from this form -- a client-supplied string would be worthless as a
// record of what was actually agreed to.

const OemDistributionPanel = () => {
  const { tenant } = useEntitlements();
  const tenantId = tenant?.id ?? null;
  const [grants, setGrants] = useState<OemDistributionGrant[] | null>(null);
  const [attestation, setAttestation] = useState<string>("");
  const [brand, setBrand] = useState("");
  const [note, setNote] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const [{ data: rows }, { data: att }] = await Promise.all([
      db.from("oem_distribution_grants")
        .select("id, tenant_id, store_id, brand, status, attested_at, attestation_version, revoked_at")
        .eq("tenant_id", tenantId)
        .order("brand", { ascending: true }),
      db.rpc("oem_attestation_text"),
    ]);
    // Null, not [], when the read failed: the policy treats "could not check"
    // as a denial, and an empty array would read as "checked, none granted".
    setGrants((rows as OemDistributionGrant[] | null) ?? null);
    const first = Array.isArray(att) ? (att[0] as { body?: string } | undefined) : null;
    if (first?.body) setAttestation(first.body);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => (grants || []).filter((g) => g.status === "active"), [grants]);
  const revoked = useMemo(() => (grants || []).filter((g) => g.status !== "active"), [grants]);

  const label = (b: string) => {
    const key = resolveOemBrand(b);
    return key ? oemDisplayName(key) : b.toUpperCase();
  };

  const add = async () => {
    const key = grantBrandKey(brand);
    if (!key) { toast.error("Enter the manufacturer"); return; }
    if (!agreed) { toast.error("Confirm the franchise attestation first"); return; }
    setBusy(true);
    try {
      const { error } = await db.rpc("grant_oem_distribution", {
        _tenant_id: tenantId, _brand: key, _store_id: null, _evidence_note: note.trim() || null,
      });
      if (error) { toast.error(error.message); return; }
      toast.success(`${label(key)} documents may now be hosted`);
      setBrand(""); setNote(""); setAgreed(false);
      await load();
    } finally { setBusy(false); }
  };

  const revoke = async (g: OemDistributionGrant) => {
    setBusy(true);
    try {
      const { error } = await db.rpc("revoke_oem_distribution", {
        _grant_id: g.id, _reason: "revoked from admin",
      });
      if (error) { toast.error(error.message); return; }
      toast.success(`${label(g.brand)} is link-only again`);
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div id="oem-distribution" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-[18px] h-[18px] text-blue-600" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-foreground">Manufacturer Document Permissions</h3>
          <p className="text-[12.5px] text-slate-500 mt-0.5">
            Brands this store is franchised for, and may therefore serve owner's manuals and brochures
            for directly. Every other vehicle links to the manufacturer's own site instead. Nothing is
            hosted without a permission listed here.
          </p>
        </div>
      </div>

      {grants === null ? (
        <p className="text-[12.5px] text-slate-500 mt-4">Could not load permissions. Documents stay link-only until this loads.</p>
      ) : active.length === 0 ? (
        <p className="text-[12.5px] text-slate-500 mt-4">No manufacturer permissions yet. Every vehicle links out.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {active.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-foreground">{label(g.brand)}</p>
                <p className="text-[11.5px] text-slate-500">
                  Attested {g.attested_at ? new Date(g.attested_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  {g.store_id ? ` · store ${g.store_id}` : " · all stores"}
                </p>
              </div>
              <button onClick={() => revoke(g)} disabled={busy}
                className="shrink-0 h-8 px-3 rounded-lg border border-border text-[12.5px] font-semibold hover:bg-muted disabled:opacity-60">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 rounded-xl border border-border p-3.5">
        <p className="text-[13px] font-bold text-foreground">Add a franchised brand</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Manufacturer (e.g. INFINITI)"
            className="h-9 px-3 rounded-lg border border-border bg-background text-[13px]" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference (optional, e.g. dealer code)"
            className="h-9 px-3 rounded-lg border border-border bg-background text-[13px]" />
        </div>
        {attestation && (
          <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 shrink-0" />
            <span className="text-[12px] text-slate-600 leading-snug">{attestation}</span>
          </label>
        )}
        <button onClick={add} disabled={busy || !agreed || !brand.trim()}
          className="mt-3 h-9 px-4 rounded-lg bg-blue-600 text-white text-[13px] font-bold inline-flex items-center gap-1.5 hover:bg-blue-700 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Confirm franchise permission
        </button>
      </div>

      {revoked.length > 0 && (
        <p className="text-[11.5px] text-slate-500 mt-3">
          {revoked.length} previously granted {revoked.length === 1 ? "brand is" : "brands are"} now link-only. Revoked
          permissions are kept as a record rather than deleted.
        </p>
      )}
    </div>
  );
};

export default OemDistributionPanel;
