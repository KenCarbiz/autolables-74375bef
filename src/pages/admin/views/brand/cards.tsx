import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Info, Upload } from "lucide-react";
import { AdminButton, AdminCard, AdminTable, InlineNote, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import wordmarkPrimary from "@/assets/admin-v2/brand/wordmark-primary.svg";
import wordmarkReverse from "@/assets/admin-v2/brand/wordmark-reverse.svg";
import { ACCENT_PRESETS, BRAND_PALETTE, DEFAULT_ACCENT_HEX, accentLabel, isHexColor, normalizeHex, validateLogoFile, type HeaderPreview, type ReadinessRow } from "./brandModel";
import { SelectControl, controlClass } from "./fields";

// Cards shared by the brand views. None of them writes: the editable
// Appearance card hands its value back to the owning form.

export const HeaderPreviewCard = ({ preview, draftDiffers }: { preview: HeaderPreview; draftDiffers: boolean }) => (
  <AdminCard title="Dealer header preview" description="How this dealership appears in AutoLabels.">
    <div className="rounded-[10px] bg-adm-sidebar px-8 py-6 flex items-center gap-5" aria-label="Application header preview">
      <img src={wordmarkReverse} alt="AutoLabels" className="h-[26px] w-auto flex-shrink-0" />
      <span className="h-10 w-px bg-white/25 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-white">
        <p className="text-[18px] leading-[24px] font-semibold truncate">{preview.name || "Dealership name"}</p>
        <p className="text-[13px] leading-[18px] text-white/80 truncate">{preview.location || "City, State"}</p>
      </div>
    </div>
    {preview.documentName && preview.documentName !== preview.name && (
      <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">
        The header shows the {preview.nameSource === "store" ? "store name from Store settings" : "dealer group name"}. Documents print the dealership name saved here: {preview.documentName}.
      </p>
    )}
    <InlineNote tone="info" className="mt-4">
      {draftDiffers ? "Preview reflects unsaved changes. Save to apply them." : "This preview shows how your dealership name and location appear in the application header."}
    </InlineNote>
  </AdminCard>
);

export const ContactReadinessCard = ({ rows }: { rows: ReadinessRow[] }) => (
  <AdminCard title="Contact readiness" description="Key dealership contact details used in customer-facing content.">
    <div className="rounded-md border border-adm-border overflow-hidden">
      <AdminTable caption="Contact readiness">
        <thead>
          <tr>
            <Th>Contact type</Th>
            <Th>Value</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <Td className="whitespace-nowrap">{r.label}</Td>
              <Td>
                {r.state === "ready" && r.href ? (
                  <a href={r.href} target={r.key === "website" ? "_blank" : undefined} rel={r.key === "website" ? "noreferrer" : undefined} className="inline-flex items-center gap-1.5 text-adm-primary hover:underline break-all">
                    {r.value}
                    {r.key === "website" && <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
                  </a>
                ) : (
                  <Link to={r.editHref} className="text-adm-danger hover:underline">{r.value}</Link>
                )}
              </Td>
              <Td className="text-right">
                <StatusChip tone={r.state === "ready" ? "success" : "danger"}>{r.state === "ready" ? "Ready" : "Incomplete"}</StatusChip>
              </Td>
            </tr>
          ))}
        </tbody>
      </AdminTable>
    </div>
  </AdminCard>
);

interface AppearanceCardProps {
  accent: string;
  /** Present on the owning tab only; elsewhere the card is read-only. */
  onChange?: (hex: string) => void;
  editHref?: string;
  error?: string | null;
}

export const AppearanceCard = ({ accent, onChange, editHref, error }: AppearanceCardProps) => {
  const normalized = normalizeHex(accent || DEFAULT_ACCENT_HEX);
  const presetHex = ACCENT_PRESETS.find((p) => p.hex === normalized)?.hex;
  const [customMode, setCustomMode] = useState(false);
  useEffect(() => {
    if (presetHex) setCustomMode(false);
  }, [presetHex]);
  const custom = customMode || !presetHex;
  const selectValue = custom ? "custom" : presetHex;
  const options = useMemo(() => [...ACCENT_PRESETS.map((p) => ({ value: p.hex, label: `${p.label} (${p.hex})` })), { value: "custom", label: "Custom hex" }], []);

  return (
    <AdminCard title="Appearance" description="Choose the brand colors used in AutoLabels for this dealership.">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(240px,2fr)] xl:grid-cols-[minmax(0,1.2fr)_auto_minmax(240px,1fr)] gap-6 items-start">
        <ul className="flex items-start gap-10 xl:gap-[76px] pl-1 pt-1" aria-label="Brand palette">
          {BRAND_PALETTE.map((c) => (
            <li key={c.hex} className="flex flex-col items-start gap-2">
              <span
                className={cn("block w-12 h-12 rounded-md border", c.hex === "#FFFFFF" ? "border-adm-border" : "border-transparent")}
                style={{ backgroundColor: c.hex }}
                aria-hidden="true"
              />
              <span className="text-[12px] leading-[16px] text-adm-ink">
                {c.label}
                {c.hex === normalized && <span className="sr-only"> (current accent)</span>}
              </span>
              <span className="text-[12px] leading-[16px] text-adm-muted -mt-1">{c.hex}</span>
            </li>
          ))}
        </ul>
        <span className="hidden lg:block w-px self-stretch bg-adm-border" aria-hidden="true" />
        <div>
          <p className="text-[13px] leading-[18px] font-semibold text-adm-ink inline-flex items-center gap-1.5">
            Workspace accent
            <Info className="w-4 h-4 text-adm-muted" aria-label="Used where a dealer colour applies on documents and the Passport" />
          </p>
          {onChange ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border border-adm-border flex-shrink-0" style={{ backgroundColor: isHexColor(normalized) ? normalized : DEFAULT_ACCENT_HEX }} aria-hidden="true" />
                <SelectControl
                  aria-label="Workspace accent"
                  value={selectValue}
                  options={options}
                  onChange={(v) => {
                    if (v === "custom") { setCustomMode(true); return; }
                    setCustomMode(false);
                    onChange(v);
                  }}
                />
              </div>
              {custom && (
                <input
                  aria-label="Custom accent hex"
                  value={accent}
                  onChange={(e) => onChange(e.target.value)}
                  onBlur={(e) => onChange(normalizeHex(e.target.value))}
                  placeholder="#2457D6"
                  className={cn(controlClass, error && "border-adm-danger")}
                />
              )}
              {error && <p className="text-[12px] leading-[18px] text-adm-danger">{error}</p>}
              <p className="text-[12px] leading-[18px] text-adm-muted">Leave blank to use the AutoLabels default.</p>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2">
              <div className={cn(controlClass, "flex items-center gap-2 bg-adm-workspace text-adm-ink")}>
                <span className="w-4 h-4 rounded-full border border-adm-border flex-shrink-0" style={{ backgroundColor: isHexColor(normalized) ? normalized : DEFAULT_ACCENT_HEX }} aria-hidden="true" />
                <span className="truncate">{accentLabel(accent)}</span>
              </div>
              {editHref && <Link to={editHref} className="text-[13px] font-semibold text-adm-primary hover:underline whitespace-nowrap">Edit</Link>}
            </div>
          )}
        </div>
      </div>
    </AdminCard>
  );
};

interface LogoFieldProps {
  logoUrl: string;
  uploading: boolean;
  onPick: (file: File) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

export const LogoField = ({ logoUrl, uploading, onPick, onRemove, disabled }: LogoFieldProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <div>
      <p className="text-[13px] leading-[18px] font-semibold text-adm-ink inline-flex items-center gap-1.5">
        Logo
        <Info className="w-4 h-4 text-adm-muted" aria-label="Shown on documents and the Passport; the AutoLabels lockup is only a placeholder" />
      </p>
      <div className="mt-1 h-[132px] rounded-md border border-dashed border-adm-border bg-adm-surface flex items-center justify-center p-4">
        {logoUrl ? (
          <img src={logoUrl} alt="Dealership logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <img src={wordmarkPrimary} alt="No dealership logo uploaded; AutoLabels wordmark shown as a placeholder" className="h-[22px] w-auto" />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml"
        className="sr-only"
        aria-label="Upload new logo"
        disabled={disabled || uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const problem = validateLogoFile(f);
          setFileError(problem);
          if (!problem) onPick(f);
        }}
      />
      <AdminButton variant="secondary" className="mt-3 w-full" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
        <Upload className="w-4 h-4" aria-hidden="true" />
        {uploading ? "Uploading…" : "Upload new logo"}
      </AdminButton>
      <p className={cn("mt-1.5 text-[12px] leading-[18px]", fileError ? "text-adm-danger" : "text-adm-muted")}>{fileError ?? "PNG, JPG or SVG. Max 2 MB."}</p>
      {logoUrl && onRemove && (
        <button type="button" onClick={onRemove} disabled={disabled} className="mt-1 text-[12px] font-semibold text-adm-muted hover:text-adm-danger">Remove logo</button>
      )}
    </div>
  );
};
