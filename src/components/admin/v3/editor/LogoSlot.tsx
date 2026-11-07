import { useId, useRef, useState, type ReactNode } from "react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";
import { EditorArtwork } from "./EditorArtwork";

const CHECKERBOARD =
  "bg-[length:16px_16px] bg-[linear-gradient(45deg,#E4E9E3_25%,transparent_25%,transparent_75%,#E4E9E3_75%),linear-gradient(45deg,#E4E9E3_25%,#FFFFFF_25%,#FFFFFF_75%,#E4E9E3_75%)] [background-position:0_0,8px_8px]";

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export function validateLogoFile(file: { type: string; size: number }, allowed: readonly string[], maxBytes: number): string | null {
  if (!allowed.includes(file.type)) return "Use a PNG, JPEG, SVG or WebP file.";
  if (file.size > maxBytes) return `File is too large. The limit is ${Math.round((maxBytes / (1024 * 1024)) * 10) / 10} MB.`;
  if (file.size === 0) return "File is empty.";
  return null;
}

/**
 * Preview and controls for one logo variant. Uploading is the caller's job: this component only reports the chosen
 * file. The image is never cropped, stretched or recolored.
 */
export const LogoSlot = ({
  label,
  src,
  alt,
  allowedTypes = LOGO_TYPES,
  maxBytes = LOGO_MAX_BYTES,
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
  allowedTypes?: readonly string[];
  /** Largest file accepted before onSelectFile is called. Defaults to 2 MB. */
  maxBytes?: number;
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
  const [fileError, setFileError] = useState<string | null>(null);
  const shownError = fileError ?? error;
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
            <EditorArtwork name="upload-logo" className="h-[56px] w-[90px]" />
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
      {shownError && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] leading-[18px] font-medium text-adm-danger">
          <AdminIcon name="alert" size="inline" className="mt-px" />
          {shownError}
        </p>
      )}
      {guidance && <p className="text-[13px] leading-[18px] text-adm-muted">{guidance}</p>}
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept={allowedTypes.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const problem = validateLogoFile(file, allowedTypes, maxBytes);
            setFileError(problem);
            if (!problem) onSelectFile(file);
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
