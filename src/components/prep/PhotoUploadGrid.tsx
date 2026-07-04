import { useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { toast } from "sonner";
import { uploadPhoto } from "@/lib/storage";

interface PhotoUploadGridProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  uploadOpts: { tenantId?: string | null; storeId?: string; vin?: string };
  required?: boolean;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

const PhotoUploadGrid = ({
  photos,
  onChange,
  uploadOpts,
  required,
  label,
  compact,
  disabled,
  onBusyChange,
}: PhotoUploadGridProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);

  const setBusy = (n: number) => {
    setUploading(n);
    onBusyChange?.(n > 0);
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(files.length);
    let remaining = files.length;
    const uploadedUrls: string[] = [];
    for (const file of files) {
      try {
        const uploaded = await uploadPhoto("prep-photos", file, uploadOpts);
        if (uploaded?.url) uploadedUrls.push(uploaded.url);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `Upload failed for ${file.name}`);
      }
      remaining -= 1;
      setBusy(remaining);
    }
    if (uploadedUrls.length) onChange([...photos, ...uploadedUrls]);
  };

  const satisfied = photos.length > 0;

  return (
    <div>
      {label && (
        <p className="text-xs font-semibold text-foreground mb-2">{label}</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {photos.map((url, i) => (
          <div key={`${url}-${i}`} className="relative aspect-square rounded-xl overflow-hidden border border-emerald-300 bg-muted">
            <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
            {!disabled && (
              <button
                onClick={() => onChange(photos.filter((_, idx) => idx !== i))}
                className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"
                aria-label="Remove photo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: uploading }).map((_, i) => (
          <div key={`up-${i}`} className="aspect-square rounded-xl border border-amber-300 bg-amber-50 flex flex-col items-center justify-center gap-1.5">
            <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[10px] font-semibold text-amber-700">Uploading</span>
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          onClick={() => inputRef.current?.click()}
          className={`mt-2 w-full ${compact ? "h-11" : "h-12"} rounded-xl border-2 border-dashed flex items-center justify-center gap-2 text-sm font-semibold transition ${
            required && !satisfied
              ? "border-amber-400 bg-amber-50 text-amber-700"
              : "border-border bg-card text-blue-600 hover:border-blue-300"
          }`}
        >
          <Camera className="w-4 h-4" /> Add Photo
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files || []);
          e.currentTarget.value = "";
          handleFiles(files);
        }}
      />
      {required && !satisfied && uploading === 0 && (
        <p className="mt-1.5 text-xs font-semibold text-amber-600">
          Photo required before you can submit this item.
        </p>
      )}
      {required && satisfied && (
        <p className="mt-1.5 text-xs font-semibold text-emerald-600 inline-flex items-center gap-1">
          <Check className="w-3.5 h-3.5" /> Photo proof attached
        </p>
      )}
    </div>
  );
};

export default PhotoUploadGrid;
