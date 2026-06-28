import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Circle, ShieldCheck, Wrench, Sparkles, ImageIcon, Building2, ClipboardCheck } from "lucide-react";

// ──────────────────────────────────────────────────────────────────────
// DeliverySignoffs — the human sign-offs a vehicle needs before delivery,
// condition-aware (new vs used). Read-only status surface over the existing
// sign-off tables; completion happens via the service/prep QR flows.
//   • Service inspection sign-off  — PDI (new) / safety K-208 (used)
//   • Open recall review           — recall_service_tasks resolved
//   • Prep & install sign-off + photo — prep_sign_offs (foreman + install_photos)
//   • Accessory / equipment install proofs — install_proofs (third-party + photo)
//   • Detail entry                 — detail_signoffs (condition-labeled)
// ──────────────────────────────────────────────────────────────────────

interface Props {
  vin: string | null;
  tenantId: string | null;
  condition: string | null;
}

interface Row {
  key: string;
  title: string;
  sub: string;
  icon: React.ElementType;
  done: boolean;
  photos?: number;
}

export const DeliverySignoffs = ({ vin, tenantId, condition }: Props) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const isNew = String(condition || "").toLowerCase() === "new";

  const load = useCallback(async () => {
    const v = (vin || "").toUpperCase();
    if (!v || !tenantId) return;
    // deno-lint-ignore no-explicit-any
    const sb = supabase as unknown as { from: (t: string) => any };
    const [insp, prep, detail, installs, recall] = await Promise.all([
      sb.from("safety_inspections").select("status, form_type, result, signed_at, documents").eq("vin", v).eq("tenant_id", tenantId),
      sb.from("prep_sign_offs").select("listing_unlocked, foreman_name, install_photos, signed_at, status").eq("vehicle_vin", v).eq("tenant_id", tenantId),
      sb.from("detail_signoffs").select("status, detail_types, installs, is_third_party, provider_company, performer_role, performer_name, photos, signed_at").eq("vin", v).eq("tenant_id", tenantId),
      sb.from("install_proofs").select("product_name, installer_company, photo_path, is_verified").eq("vehicle_vin", v),
      sb.from("recall_service_tasks").select("status").eq("vin", v).eq("tenant_id", tenantId),
    ]);

    const inspRows = (insp.data || []) as { status: string; documents: unknown[] | null }[];
    const inspSigned = inspRows.find((r) => r.status === "signed");
    const prepRows = (prep.data || []) as { listing_unlocked: boolean; foreman_name: string | null; install_photos: unknown[] | null }[];
    const prepDone = prepRows.find((r) => r.listing_unlocked);
    const detailRows = (detail.data || []) as { status: string; is_third_party: boolean; provider_company: string | null; performer_role: string | null; photos: unknown[] | null }[];
    const detailSignedRows = detailRows.filter((r) => r.status === "signed");
    const detailSigned = detailSignedRows[0];
    const ROLE_LABEL: Record<string, string> = { detail: "Detail", service: "Service", parts: "Parts", recon: "Recon", outside: "Outside vendor" };
    const detailParties = Array.from(new Set(detailSignedRows.map((r) =>
      (r.is_third_party && r.provider_company) ? r.provider_company : (ROLE_LABEL[r.performer_role || ""] || "Detail"))));
    const detailPhotoCount = detailSignedRows.reduce((n, r) => n + (r.photos || []).length, 0);
    const installRows = (installs.data || []) as { product_name: string; installer_company: string | null; photo_path: string | null }[];
    const recallRows = (recall.data || []) as { status: string }[];
    const openRecall = recallRows.some((r) => r.status === "open_review");

    const prepPhotos = (prepDone?.install_photos || []).length;
    const installPhotos = installRows.filter((r) => r.photo_path).length;

    setRows([
      {
        key: "inspection",
        title: isNew ? "Pre-delivery inspection (PDI) sign-off" : "Safety inspection sign-off (K-208)",
        sub: inspSigned ? "Service department signed off" : "Awaiting service sign-off",
        icon: ClipboardCheck,
        done: !!inspSigned,
        photos: ((inspSigned?.documents as unknown[]) || []).length || undefined,
      },
      {
        key: "recall",
        title: "Open recall review",
        sub: recallRows.length === 0 ? "No open recall on file" : openRecall ? "Service review required" : "Reviewed by service",
        icon: ShieldCheck,
        done: !openRecall,
      },
      {
        key: "prep",
        title: "Prep & install sign-off + photo",
        sub: prepDone ? `Signed by ${prepDone.foreman_name || "prep"}${prepPhotos ? ` · ${prepPhotos} photo${prepPhotos === 1 ? "" : "s"}` : " · add a completion photo"}` : "Prep has not signed off",
        icon: Wrench,
        done: !!prepDone,
        photos: prepPhotos || undefined,
      },
      {
        key: "installs",
        title: "Accessory / equipment install proofs",
        sub: installRows.length
          ? `${installRows.length} installed${installPhotos ? ` · ${installPhotos} with photo` : ""}${installRows.some((r) => r.installer_company) ? " · incl. third-party" : ""}`
          : "No installed-equipment proofs yet",
        icon: Building2,
        done: installRows.length > 0 && installPhotos === installRows.length,
        photos: installPhotos || undefined,
      },
      {
        key: "detail",
        title: isNew ? "Detail & install — ready for new-car inventory" : "Detail & install — used-car inventory",
        sub: detailSignedRows.length
          ? `${detailSignedRows.length} sign-off${detailSignedRows.length === 1 ? "" : "s"} · ${detailParties.join(", ")}${detailPhotoCount ? ` · ${detailPhotoCount} photo${detailPhotoCount === 1 ? "" : "s"}` : ""}`
          : "No detail / install sign-off yet",
        icon: Sparkles,
        done: detailSignedRows.length > 0,
        photos: detailPhotoCount || undefined,
      },
    ]);
  }, [vin, tenantId, isNew]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return null;
  const done = rows.filter((r) => r.done).length;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Pre-Delivery Sign-Offs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Service, prep, install, and detail sign-offs required before {isNew ? "new-car" : "used-car"} delivery.</p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${done === rows.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{done}/{rows.length} complete</span>
      </div>
      <div className="divide-y divide-border/60">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="flex items-center gap-3 py-2.5">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${r.done ? "bg-emerald-50 text-emerald-600" : "bg-muted text-muted-foreground"}`}><Icon className="w-4 h-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-foreground truncate">{r.title}</p>
                <p className="text-[11px] text-muted-foreground truncate">{r.sub}</p>
              </div>
              {r.photos ? <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5 shrink-0"><ImageIcon className="w-3 h-3" />{r.photos}</span> : null}
              {r.done ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground/50 shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DeliverySignoffs;
