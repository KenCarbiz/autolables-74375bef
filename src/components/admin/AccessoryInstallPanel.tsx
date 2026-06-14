import { useRef, useState } from "react";
import { Camera, CheckCircle2, Upload, X, ImageIcon, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import SignaturePad from "@/components/addendum/SignaturePad";
import type { GetReadyRecord, AccessoryToInstall } from "@/hooks/useGetReady";

// ──────────────────────────────────────────────────────────────
// AccessoryInstallPanel — Wave 17.
//
// Per-vehicle installer workflow. Lists every accessory on the
// get-ready record; for each pending one, lets the installer
// upload one or more photos to the accessory-install-photos
// Supabase Storage bucket and sign their name. On submit, calls
// markAccessoryInstalled with the proof payload — the Wave 13a
// useGetReady hook merges photos + signature into the
// accessories_to_install JSONB and stamps installedDate/By.
//
// Already-installed accessories render a compact summary (date,
// installer, photo count) so the foreman sees full provenance
// before sign-off. Customer-facing surfaces (/v/:slug receipt,
// Audit-Defense Packet) pull from the same JSONB so install
// proof flows downstream without a second write path.
// ──────────────────────────────────────────────────────────────

interface Props {
  record: GetReadyRecord;
  onMarkInstalled: (
    recordId: string,
    productId: string,
    installedBy: string,
    proof: {
      photos: string[];
      signature_data?: string;
      signature_type?: "draw" | "type";
    },
  ) => Promise<void>;
}

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—");

export const AccessoryInstallPanel = ({ record, onMarkInstalled }: Props) => {
  const accessories = record.accessoriesToInstall || [];
  if (accessories.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
        No accessories on this vehicle's get-ready plan.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {accessories.map((acc) => (
        <AccessoryRow
          key={acc.productId}
          recordId={record.id}
          vin={record.vin}
          accessory={acc}
          onMarkInstalled={onMarkInstalled}
        />
      ))}
    </div>
  );
};

interface RowProps {
  recordId: string;
  vin: string;
  accessory: AccessoryToInstall;
  onMarkInstalled: Props["onMarkInstalled"];
}

const AccessoryRow = ({ recordId, vin, accessory, onMarkInstalled }: RowProps) => {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [installerName, setInstallerName] = useState(user?.email?.split("@")[0] || "");
  const [signature, setSignature] = useState<{ data: string; type: "draw" | "type" } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isComplete = accessory.installed;
  const existingPhotoCount = (accessory.install_photos || []).length;

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !tenant?.id) return;
    setUploading(true);
    const uploaded: string[] = [];
    try {
      for (const file of Array.from(files)) {
        // Path: {tenant_id}/{vin}/{product_id}/{timestamp}_{name}
        // First segment is tenant_id so the bucket RLS scopes
        // reads/writes correctly.
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${tenant.id}/${vin}/${accessory.productId}/${Date.now()}_${safeName}`;
        const { error } = await (supabase.storage as any)
          .from("accessory-install-photos")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) {
          toast.error(`Upload failed: ${file.name}`);
          continue;
        }
        uploaded.push(path);
      }
      if (uploaded.length > 0) {
        setPhotoUrls(prev => [...prev, ...uploaded]);
        toast.success(`${uploaded.length} photo${uploaded.length === 1 ? "" : "s"} uploaded`);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async () => {
    if (!installerName.trim()) {
      toast.error("Installer name required");
      return;
    }
    if (!signature || !signature.data) {
      toast.error("Installer signature required");
      return;
    }
    setSubmitting(true);
    try {
      await onMarkInstalled(recordId, accessory.productId, installerName.trim(), {
        photos: photoUrls,
        signature_data: signature.data,
        signature_type: signature.type,
      });
      toast.success(`${accessory.productName} marked installed`);
      // Reset; the parent's load() refresh will collapse this
      // accessory into the "already installed" branch on next
      // render so resetting state here is just hygiene.
      setExpanded(false);
      setPhotoUrls([]);
      setSignature(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't mark installed");
    } finally {
      setSubmitting(false);
    }
  };

  // Already-installed branch — compact summary + non-editable.
  if (isComplete) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 flex-shrink-0" strokeWidth={2.25} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{accessory.productName}</p>
            <p className="text-[11px] text-muted-foreground">
              Installed {fmtDate(accessory.installedDate)} · by {accessory.installedBy || "—"}
              {existingPhotoCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-0.5 text-emerald-700">
                  <ImageIcon className="w-3 h-3" />
                  {existingPhotoCount}
                </span>
              )}
              {accessory.installer_signature_data && (
                <span className="ml-2 inline-flex items-center gap-0.5 text-emerald-700">
                  <ShieldCheck className="w-3 h-3" />
                  signed
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Pending — collapsed compact, expandable to upload + sign UI.
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="w-4 h-4 rounded-full border-2 border-amber-400 flex-shrink-0" />
          <p className="text-sm font-semibold text-foreground truncate">{accessory.productName}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
          {expanded ? "cancel" : "Mark installed"}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-amber-200 px-3 py-3 space-y-3 bg-white">
          {/* Photos */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1.5">
              Install photos ({photoUrls.length} ready)
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {photoUrls.map((p, i) => (
                <div key={i} className="relative w-14 h-14 rounded-md border border-border bg-muted overflow-hidden">
                  <ImageIcon className="absolute inset-0 m-auto w-5 h-5 text-muted-foreground" />
                  <span className="absolute inset-x-0 bottom-0 text-[9px] text-center font-semibold bg-foreground/80 text-white py-0.5">
                    Ready
                  </span>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-14 h-14 rounded-md border-2 border-dashed border-border hover:border-foreground/40 hover:bg-muted/40 flex flex-col items-center justify-center text-[10px] text-muted-foreground disabled:opacity-50"
                title="Upload photos"
              >
                {uploading ? "…" : <><Camera className="w-4 h-4 mb-0.5" />Add</>}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={(e) => handleUpload(e.target.files)}
              className="hidden"
            />
            <p className="text-[9px] text-muted-foreground mt-1.5">
              Up to 10 MB each · JPEG/PNG/WebP/HEIC · scoped to this vehicle in the install bucket.
            </p>
          </div>

          {/* Installer name */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground mb-1">
              Installer name
            </p>
            <input
              value={installerName}
              onChange={(e) => setInstallerName(e.target.value)}
              placeholder="Tech / installer name"
              className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm"
            />
          </div>

          {/* Installer signature */}
          <SignaturePad
            label="Installer signature"
            subtitle="The tech doing the work signs here. Captured into the Audit-Defense Packet."
            onChange={(data, type) => setSignature({ data, type })}
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="h-9 px-3 rounded-md text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !signature?.data}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="w-3.5 h-3.5" />
              {submitting ? "Saving…" : "Mark installed"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccessoryInstallPanel;
