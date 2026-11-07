import { useId, useRef, type ReactNode } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";
import { EditorArtwork } from "./EditorArtwork";

const CHECKERBOARD =
  "bg-[length:16px_16px] bg-[linear-gradient(45deg,#E4E9E3_25%,transparent_25%,transparent_75%,#E4E9E3_75%),linear-gradient(45deg,#E4E9E3_25%,#FFFFFF_25%,#FFFFFF_75%,#E4E9E3_75%)] [background-position:0_0,8px_8px]";

/**
 * Preview and controls for one logo variant. Uploading is the caller's job: this component only reports the chosen
 * file. The image is never cropped, stretched or recolored.
 */
export const LogoSlot = ({
  label,
  src,
  alt,
  accept = "image/png,image/svg+xml,image/webp,image/jpeg",
  guidance,
  uploading,
  progress,
  error,
  disabled,
  onSelectFile,
  onRemove,
  surface = "light",
  children,
}: {
  label: string;
  src?: string | null;
  alt?: string;
  accept?: string;
  guidance?: ReactNode;
  uploading?: boolean;
  /** 0 to 100 */
  progress?: number;
  error?: ReactNode;
  disabled?: boolean;
  onSelectFile: (file: File) => void;
  onRemove?: () => void;
  surface?: "light" | "dark";
  children?: ReactNode;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const has = Boolean(src);
  return (
    <div className="rounded-xl border border-adm-divider bg-adm-surface p-4 min-w-0 space-y-3">
      <p id={`${id}-label`} className="text-[14px] leading-[20px] font-semibold text-adm-ink">{label}</p>
      <div
        data-logo-stage=""
        data-surface={surface}
        className={cn("relative flex items-center justify-center w-full h-[96px] sm:h-[120px] rounded-lg border border-dashed border-adm-border p-6 overflow-hidden", surface === "dark" ? "bg-[#162638]" : CHECKERBOARD)}
      >
        {has ? (
          <img src={src ?? undefined} alt={alt ?? `${label} preview`} className="max-w-full max-h-full w-auto h-auto object-contain" />
        ) : (
          <div className="flex flex-col items-center text-center gap-1">
            <EditorArtwork name="upload-logo" className="w-[96px]" />
            <span className={cn("text-[13px]", surface === "dark" ? "text-white/80" : "text-adm-muted")}>No logo uploaded</span>
          </div>
        )}
      </div>
      {uploading && (
        <div role="status" className="space-y-1">
          <div className="h-2 rounded-full bg-adm-workspace overflow-hidden" aria-hidden="true">
            <div className="h-full bg-adm-primary transition-[width]" style={{ width: `${Math.max(4, Math.min(100, progress ?? 0))}%` }} />
          </div>
          <p className="text-[13px] text-adm-muted">Uploading{progress !== undefined ? ` ${Math.round(progress)} percent` : ""}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] leading-[18px] font-medium text-adm-danger">
          <AdminIcon name="alert" size="compact" className="mt-px" />
          {error}
        </p>
      )}
      {guidance && <p className="text-[13px] leading-[18px] text-adm-muted">{guidance}</p>}
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSelectFile(file);
            e.target.value = "";
          }}
        />
        <AdminButton variant={has ? "secondary" : "primary"} aria-label={`${has ? "Replace" : "Upload"} ${label}`} disabled={disabled || uploading} onClick={() => input.current?.click()}>
          <AdminIcon name="upload" />
          {has ? "Replace" : "Upload"}
        </AdminButton>
        {has && onRemove && (
          <AdminButton variant="danger" aria-label={`Remove ${label}`} disabled={disabled || uploading} onClick={onRemove}>
            <AdminIcon name="close" />
            Remove
          </AdminButton>
        )}
      </div>
      {children}
    </div>
  );
};
