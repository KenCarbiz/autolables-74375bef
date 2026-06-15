import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BadgeCheck, Camera } from "lucide-react";

// Dealer-side view of vendor/detail-shop install proofs for a VIN. Photos
// live in the private install-proofs bucket, so each is fetched through a
// short-lived signed URL. Renders nothing when there are no proofs.

interface Proof {
  id: string;
  product_name: string | null;
  installer_name: string | null;
  installer_company: string | null;
  installed_at: string | null;
  photo_path: string | null;
  notes: string | null;
  created_at: string;
}

const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "—";

export const InstallProofList = ({ vin }: { vin: string }) => {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("install_proofs")
        .select("id,product_name,installer_name,installer_company,installed_at,photo_path,notes,created_at")
        .eq("vehicle_vin", vin)
        .order("created_at", { ascending: false });
      const rows = (data as Proof[]) || [];
      if (cancelled) return;
      setProofs(rows);
      const map: Record<string, string> = {};
      await Promise.all(
        rows
          .filter((r) => r.photo_path)
          .map(async (r) => {
            const { data: signed } = await supabase.storage
              .from("install-proofs")
              .createSignedUrl(r.photo_path as string, 3600);
            if (signed?.signedUrl) map[r.id] = signed.signedUrl;
          }),
      );
      if (!cancelled) {
        setUrls(map);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vin]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Loading installer proofs…
      </div>
    );
  }
  if (proofs.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <BadgeCheck className="w-4 h-4 text-emerald-600" />
        <p className="text-body-sm font-semibold text-foreground">Installer proof of installation</p>
        <span className="text-caption text-muted-foreground">· {proofs.length}</span>
      </div>
      <div className="divide-y divide-border">
        {proofs.map((p) => (
          <div key={p.id} className="p-4 flex gap-3">
            {urls[p.id] ? (
              <a href={urls[p.id]} target="_blank" rel="noreferrer" className="flex-shrink-0">
                <img src={urls[p.id]} alt="Installed equipment" className="w-16 h-16 rounded-lg object-cover border border-border" />
              </a>
            ) : p.photo_path ? (
              <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Camera className="w-5 h-5 text-muted-foreground" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{p.product_name || "Installed equipment"}</p>
              <p className="text-caption text-muted-foreground">
                Verified by {p.installer_name || "installer"}{p.installer_company ? ` · ${p.installer_company}` : ""}
              </p>
              <p className="text-caption text-muted-foreground">Installed {fmt(p.installed_at)}</p>
              {p.notes && <p className="text-caption text-foreground mt-1">{p.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InstallProofList;
