import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link as LinkIcon, Upload, X } from "lucide-react";
import { Card, btnPrimary } from "./primitives";
import type { VehicleRow } from "./types";

// Uploads and links attached to this vehicle. Everything here also appears on
// the shopper packet's Documents page.
//
// The FTC Buyers Guide and the state safety inspection are generated, signed
// and filed by the official-forms flow above; the title and MCO live on the
// Compliance tab. They are intentionally NOT upload slots, so a divergent
// second copy can never be created.

const USED_SLOTS: Array<{ type: string; label: string; desc: string }> = [
  { type: "factory_sticker", label: "OEM window sticker (Monroney)", desc: "Original factory window sticker PDF, image, or link — shows to shoppers in the packet." },
  { type: "brochure", label: "Vehicle brochure", desc: "OEM or dealer brochure PDF / link — shows on the packet's Documents page." },
  { type: "emissions", label: "Emissions / smog certificate", desc: "State emissions certificate where required." },
  { type: "carfax", label: "Carfax / AutoCheck", desc: "Vehicle history report — attach for buyer review." },
  { type: "recon", label: "Inspection / MPI report", desc: "Multi-point reconditioning inspection report." },
  { type: "odometer", label: "Odometer disclosure", desc: "Federal odometer disclosure statement." },
  { type: "warranty", label: "Warranty / service contract", desc: "Limited warranty, service contract (VSC), or GAP documents." },
  { type: "we_owe", label: "\"We owe\" / Due bill", desc: "Items the dealership agreed to deliver post-sale (e.g. a pending install)." },
  { type: "other", label: "Other", desc: "Anything else relevant to the deal jacket." },
];

const NEW_SLOTS: Array<{ type: string; label: string; desc: string }> = [
  { type: "factory_sticker", label: "Factory window sticker", desc: "OEM Monroney PDF / image — shown to the buyer at signing." },
  { type: "brochure", label: "Vehicle brochure", desc: "OEM or dealer brochure PDF / link — shows on the packet's Documents page." },
  { type: "carfax", label: "Carfax / AutoCheck", desc: "Vehicle history report." },
  { type: "warranty", label: "Warranty / service contract", desc: "Limited warranty, service contract (VSC), or GAP documents." },
  { type: "we_owe", label: "\"We owe\" / Due bill", desc: "Items the dealership agreed to deliver post-sale." },
  { type: "other", label: "Other", desc: "Anything else — inspection, MPI, warranty paperwork." },
];

export const DocumentUploads = ({ vehicle, onReload }: { vehicle: VehicleRow; onReload: () => void }) => {
  const [uploading, setUploading] = useState<string | null>(null);
  const [linkSlot, setLinkSlot] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  // Used cars carry the full compliance document set; new cars a lighter one.
  // CPO and unknown-condition default to the used set (the safer superset).
  const slots = vehicle.condition === "new" ? NEW_SLOTS : USED_SLOTS;

  const addLink = async (type: string) => {
    const raw = linkUrl.trim();
    if (!raw) { toast.error("Paste a link first"); return; }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    // Append server-side. Building the next array from React state and writing
    // the whole array back deleted anything attached since this tab loaded.
    const { error } = await (supabase as any).rpc("append_vehicle_document", {
      _vehicle_id: vehicle.id,
      _doc: { name: linkName.trim() || url, type, url },
    });
    if (error) { toast.error("Failed to add link"); return; }
    setLinkSlot(null); setLinkName(""); setLinkUrl("");
    toast.success("Link added");
    onReload();
  };

  const removeDoc = async (doc: { name: string; url: string; type: string }) => {
    const { error } = await (supabase as any).rpc("remove_vehicle_document", {
      _vehicle_id: vehicle.id, _name: doc.name, _url: doc.url, _type: doc.type,
    });
    if (error) { toast.error("Failed to remove"); return; }
    toast.success("Removed");
    onReload();
  };

  const upload = async (file: File, type: string) => {
    if (!vehicle.tenant_id) {
      toast.error("Vehicle has no tenant — re-save the vehicle file first");
      return;
    }
    setUploading(type);
    const ext = file.name.split(".").pop() || "bin";
    const path = `${vehicle.tenant_id}/${vehicle.id}/${type}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("vehicle-docs")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) {
      // Try to auto-create the bucket once; ignore failures.
      await supabase.storage.createBucket("vehicle-docs", {
        public: false, fileSizeLimit: 25 * 1024 * 1024,
      }).catch(() => undefined);
      const retry = await supabase.storage
        .from("vehicle-docs")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (retry.error) {
        toast.error(`Upload failed: ${retry.error.message}`);
        setUploading(null);
        return;
      }
    }
    const { data: signed } = await supabase.storage
      .from("vehicle-docs")
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    const { error: updErr } = await (supabase as any).rpc("append_vehicle_document", {
      _vehicle_id: vehicle.id,
      _doc: { name: file.name, type, url: signed?.signedUrl || path },
    });
    setUploading(null);
    if (updErr) {
      toast.error("Saved the file, but could not attach it to the vehicle row");
    } else {
      toast.success(`${type.replace(/_/g, " ")} attached`);
      onReload();
    }
  };

  const filesByType = useMemo(() => {
    const m: Record<string, VehicleRow["documents"]> = {};
    (vehicle.documents || []).forEach((d) => {
      m[d.type] = m[d.type] || [];
      m[d.type].push(d);
    });
    return m;
  }, [vehicle.documents]);

  return (
    <Card title="Uploads & links">
      <p className="text-al-body text-muted-foreground">
        Attach a PDF or image, or paste a URL. Everything here appears on the shopper packet's Documents page.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {slots.map((s) => (
          <div key={s.type} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-al-card text-foreground">{s.label}</h4>
              <span className="text-al-meta text-muted-foreground shrink-0">{(filesByType[s.type] || []).length} file(s)</span>
            </div>
            <p className="text-al-meta text-muted-foreground">{s.desc}</p>
            {(filesByType[s.type] || []).map((d, i) => (
              <div key={`${d.url}-${i}`} className="flex items-center gap-2">
                <a href={d.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-al-meta text-primary hover:underline truncate">{d.name}</a>
                <button
                  type="button"
                  onClick={() => removeDoc(d)}
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  title="Remove"
                  aria-label={`Remove ${d.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-dashed border-border text-al-meta font-semibold cursor-pointer hover:bg-muted">
                <Upload className="w-3 h-3" />
                {uploading === s.type ? "Uploading…" : "Upload"}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(f, s.type);
                    e.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => { setLinkSlot(linkSlot === s.type ? null : s.type); setLinkName(""); setLinkUrl(""); }}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-al-meta font-semibold hover:bg-muted"
              >
                <LinkIcon className="w-3 h-3" /> Add link
              </button>
            </div>
            {linkSlot === s.type && (
              <div className="space-y-1.5 pt-1.5">
                <input
                  value={linkName}
                  onChange={(e) => setLinkName(e.target.value)}
                  placeholder="Label (optional)"
                  className="w-full h-8 rounded-lg border border-border bg-background px-2.5 text-al-meta text-foreground"
                />
                <div className="flex gap-1.5">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://…"
                    className="flex-1 h-8 rounded-lg border border-border bg-background px-2.5 text-al-meta text-foreground"
                  />
                  <button type="button" onClick={() => addLink(s.type)} className={`${btnPrimary} h-8`}>Add</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

export default DocumentUploads;
