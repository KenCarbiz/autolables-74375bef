import emptyActivity from "@/assets/admin-v3/artwork/empty-activity.svg";
import emptyDocuments from "@/assets/admin-v3/artwork/empty-documents.svg";
import emptySearch from "@/assets/admin-v3/artwork/empty-search.svg";
import noPreview from "@/assets/admin-v3/artwork/no-preview.svg";
import uploadLogo from "@/assets/admin-v3/artwork/upload-logo.svg";
import { cn } from "@/lib/utils";
import { AdminIconTile } from "./AdminIcon";

const SOURCES = {
  activity: emptyActivity,
  documents: emptyDocuments,
  search: emptySearch,
  "no-preview": noPreview,
  "upload-logo": uploadLogo,
} as const;
export type ArtworkName = keyof typeof SOURCES;

/** Quiet decorative illustration. Always hidden from assistive tech; the surrounding text carries the meaning. */
export const EditorArtwork = ({ name, className }: { name: ArtworkName; className?: string }) => (
  <img src={SOURCES[name]} alt="" aria-hidden="true" className={cn("h-[104px] w-[160px] max-w-full object-contain opacity-90", className)} />
);

/** Empty, no-result, error or setup state: artwork, a title, supporting text and one action. */
export const EditorEmpty = ({
  artwork,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: {
  artwork?: ArtworkName;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
}) => (
  <div role={tone === "danger" ? "alert" : undefined} className={cn("flex flex-col items-center text-center px-4 py-10", className)}>
    {tone === "danger" ? <AdminIconTile name="alert" tone="danger" className="mb-3" /> : artwork && <EditorArtwork name={artwork} className="mb-4" />}
    <p className={cn("text-[16px] leading-[22px] font-semibold", tone === "danger" ? "text-adm-danger" : "text-adm-ink")}>{title}</p>
    {description && <p className="mt-1 max-w-md text-[14px] leading-[20px] text-adm-muted">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
