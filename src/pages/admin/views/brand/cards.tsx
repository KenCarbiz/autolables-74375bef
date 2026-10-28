import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Info, Upload } from "lucide-react";
import { AdminButton, AdminCard, AdminTable, ICON, InlineNote, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import wordmarkPrimary from "@/assets/admin-v2/brand/wordmark-primary.svg";
import wordmarkReverse from "@/assets/admin-v2/brand/wordmark-reverse.svg";
import { ACCENT_PRESETS, BRAND_PALETTE, DEFAULT_ACCENT_HEX, accentLabel, isHexColor, normalizeHex, validateLogoFile, type HeaderPreview, type ReadinessRow } from "./brandModel";
import { SelectControl, controlClass } from "./fields";

// Cards shared by the brand views. None of them writes: the editable
// Appearance card hands its value back to the owning form.

/** Card titles and descriptions drawn to the reference (20px title, 14px description) inside AdminCard's header. */
export const CardTitle = ({ children }: { children: ReactNode }) => <span className="block text-[20px] leading-[28px]">{children}</span>;
export const CardDescription = ({ children }: { children: ReactNode }) => <span className="block pt-px text-[14px] leading-[20px]">{children}</span>;

const FIELD_LABEL = "text-[14px] leading-[20px] font-semibold text-adm-ink flex items-center gap-1.5";
/** The reference sets card titles 23px under the card edge; AdminCard's 20px header padding plus the 28px title line lands 4px lower. */
export const CARD_HEADER = "pt-4";

export const HeaderPreviewCard = ({ preview, draftDiffers }: { preview: HeaderPreview; draftDiffers: boolean }) => (
  <AdminCard title={<CardTitle>Dealer header preview</CardTitle>} description={<CardDescription>How this dealership appears in AutoLabels.</CardDescription>} headerClassName={CARD_HEADER} bodyClassName="px-[22px]">
    <div className="mt-2 rounded-[10px] bg-adm-sidebar px-[36px] min-h-[100px] flex items-center gap-[22px]" aria-label="Application header preview">
      <img src={wordmarkReverse} alt="AutoLabels" className="h-[21px] w-auto flex-shrink-0" />
      <span className="h-10 w-px bg-white/25 flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-white">
        <p className="text-[18px] leading-[24px] font-semibold truncate" data-parity="dealer-identity">{preview.name || "Dealership name"}</p>
        <p className="text-[13px] leading-[18px] text-white/80 truncate" data-parity="dealer-identity">{preview.location || "City, State"}</p>
      </div>
    </div>
    {preview.documentName && preview.documentName !== preview.name && (
      <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">
        The header shows the {preview.nameSource === "store" ? "store name from Store settings" : "dealer group name"}. Documents print the dealership name saved here: <span data-parity="dealer-identity">{preview.documentName}</span>.
      </p>
    )}
    <InlineNote tone="info" className="mt-[13px]">
      {draftDiffers ? "Preview reflects unsaved changes. Save to apply them." : "This preview shows how your dealership name and location appear in the application header."}
    </InlineNote>
  </AdminCard>
);

// Reference table: 36px header, 41px rows, 28px chips right-aligned 20px from the box.
export const ContactReadinessCard = ({ rows }: { rows: ReadinessRow[] }) => (
  <AdminCard title={<CardTitle>Contact readiness</CardTitle>} description={<CardDescription>Key dealership contact details used in customer-facing content.</CardDescription>} headerClassName={CARD_HEADER} bodyClassName="px-[22px] pb-8">
    <div className="rounded-md border border-adm-border overflow-hidden">
      <AdminTable caption="Contact readiness">
        <thead>
          <tr>
            <Th className="px-[15px] py-[9px] text-adm-ink">Contact type</Th>
            <Th className="px-[15px] py-[9px] text-adm-ink">Value</Th>
            <Th className="px-[15px] py-[9px] text-adm-ink">Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <Td className="px-[15px] py-[10px] whitespace-nowrap">{r.label}</Td>
              <Td className="px-[15px] py-[10px]">
                {r.state === "ready" && r.href ? (
                  <a href={r.href} target={r.key === "website" ? "_blank" : undefined} rel={r.key === "website" ? "noreferrer" : undefined} className="inline-flex items-center gap-2 text-adm-primary hover:underline break-all" data-parity={r.key === "website" ? "dealer-identity" : undefined}>
                    {r.value}
                    {r.key === "website" && <ExternalLink className={cn(ICON.inline, "flex-shrink-0")} aria-hidden="true" />}
                  </a>
                ) : (
                  <Link to={r.editHref} className="text-adm-danger hover:underline">{r.value}</Link>
                )}
              </Td>
              <Td className="px-[15px] pr-5 py-[6px] text-right">
                <StatusChip tone={r.state === "ready" ? "success" : "danger"} className="py-[5px]">{r.state === "ready" ? "Ready" : "Incomplete"}</StatusChip>
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

// Reference: 50px swatches on a 124px pitch, a divider 45px from a 240px accent column, a 39px control with a 23px colour dot (drawn at 24).
const ACCENT_DOT = `${ICON.status} rounded-full border border-adm-border flex-shrink-0`;

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
  const dotStyle = { backgroundColor: isHexColor(normalized) ? normalized : DEFAULT_ACCENT_HEX };

  return (
    <AdminCard title={<CardTitle>Appearance</CardTitle>} description={<CardDescription>Choose the brand colors used in AutoLabels for this dealership.</CardDescription>} headerClassName={CARD_HEADER} bodyClassName="pb-5">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(240px,2fr)] xl:grid-cols-[minmax(0,1fr)_auto_240px] gap-y-6 gap-x-[45px] items-start">
        <ul className="flex items-start gap-10 xl:gap-[74px] pl-2 pt-0.5" aria-label="Brand palette">
          {BRAND_PALETTE.map((c) => (
            <li key={c.hex} className="flex flex-col items-start gap-1.5">
              <span
                className={cn("block w-[50px] h-[50px] rounded-md border", c.hex === "#FFFFFF" ? "border-adm-border" : "border-transparent")}
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
        <div className="pt-0.5">
          <p className={FIELD_LABEL}>
            Workspace accent
            <Info className={cn(ICON.inline, "text-adm-muted")} aria-label="Used where a dealer colour applies on documents and the Passport" />
          </p>
          {onChange ? (
            <div className="mt-[11px] space-y-2">
              <div className="flex items-center gap-2">
                <span className={ACCENT_DOT} style={dotStyle} aria-hidden="true" />
                <SelectControl
                  aria-label="Workspace accent"
                  value={selectValue}
                  options={options}
                  className="h-[39px] [&>select]:h-[39px]"
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
            <div className="mt-[11px]">
              <div className={cn(controlClass, "h-[39px] flex items-center gap-[10px] bg-adm-workspace text-adm-ink")}>
                <span className={ACCENT_DOT} style={dotStyle} aria-hidden="true" />
                <span className="truncate">{accentLabel(accent)}</span>
              </div>
              {editHref && <Link to={editHref} className="mt-1 inline-block text-[12px] leading-[18px] font-semibold text-adm-primary hover:underline">Edit</Link>}
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

// Reference: a 131px dashed box 11px under the label, a 41px upload button, the hint 9px under it.
export const LogoField = ({ logoUrl, uploading, onPick, onRemove, disabled }: LogoFieldProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  return (
    <div>
      <p className={FIELD_LABEL}>
        Logo
        <Info className={cn(ICON.inline, "text-adm-muted")} aria-label="Shown on documents and the Passport; the AutoLabels lockup is only a placeholder" />
      </p>
      <div className="mt-[11px] h-[131px] rounded-md border border-dashed border-adm-border bg-adm-surface flex items-center justify-center p-4" data-landmark="brand-logo">
        {logoUrl ? (
          <img src={logoUrl} alt="Dealership logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <img src={wordmarkPrimary} alt="No dealership logo uploaded; AutoLabels wordmark shown as a placeholder" className="h-6 w-auto" />
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
      <AdminButton variant="secondary" className="mt-[10px] w-full min-h-[41px] sm:min-h-[41px]" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
        <Upload className={ICON.button} aria-hidden="true" />
        {uploading ? "Uploading…" : "Upload new logo"}
      </AdminButton>
      <p className={cn("mt-[9px] text-[12px] leading-[18px]", fileError ? "text-adm-danger" : "text-adm-muted")}>{fileError ?? "PNG, JPG or SVG. Max 2 MB."}</p>
      {logoUrl && onRemove && (
        <button type="button" onClick={onRemove} disabled={disabled} className="mt-1 text-[12px] font-semibold text-adm-muted hover:text-adm-danger">Remove logo</button>
      )}
    </div>
  );
};
