import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Crumbs } from "@/components/detail/parts";
import { AdminButton, AdminCard, SkeletonBlock } from "@/components/admin/v2/primitives";
import { FilterSelect, PageBody, PageHeader } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";
import { useDealerPrintSettings } from "@/lib/stickerStudio/useDealerPrintSettings";
import { DEFAULT_CALIBRATION, PAPER, type PrintCalibration } from "@/lib/stickerStudio/printConfig";
import type { StickerType } from "@/lib/stickerStudio/templates";
import { cn } from "@/lib/utils";
import { Car } from "lucide-react";

// Printer Calibration: measure, adjust, save, retest. The saved profile is
// the dealer_print_settings row read by Sticker Studio and the /print routes;
// the test sheet opens with the current, possibly unsaved, values.

type StepId = "measure" | "adjust" | "save" | "retest";
const STEPS: Array<{ id: StepId; label: string }> = [
  { id: "measure", label: "1. Measure" },
  { id: "adjust", label: "2. Adjust" },
  { id: "save", label: "3. Save" },
  { id: "retest", label: "4. Retest" },
];

const FORMATS: Array<{ key: StickerType; label: string }> = [
  { key: "window", label: "8.5 x 11 in (Letter, window sticker)" },
  { key: "addendum", label: "4.5 x 11 in (Half letter, addendum)" },
];

const fieldCls = "h-10 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] text-adm-ink outline-none focus:ring-2 focus:ring-adm-primary";
const labelCls = "flex flex-col justify-end gap-1 text-[13px] leading-[18px] text-adm-ink";
const num = (v: number) => (Number.isFinite(v) ? v : 0);

const PX_PER_IN = 22;

const PagePreview = ({ type, cal, footer }: { type: StickerType; cal: PrintCalibration; footer?: ReactNode }) => {
  const spec = PAPER[type];
  const w = spec.widthIn * PX_PER_IN;
  const h = spec.heightIn * PX_PER_IN;
  const pad = 34;
  const narrow = w < 150;
  const inset = Math.max(cal.leftSafeMarginIn, 0) * PX_PER_IN;
  const top = Math.max(cal.topSafeMarginIn, 0) * PX_PER_IN;
  const dx = num(cal.xOffsetIn) * PX_PER_IN;
  const dy = num(cal.yOffsetIn) * PX_PER_IN;
  const s = num(cal.scalePct) / 100 || 1;
  return (
    <AdminCard inset="sm" title={type === "window" ? "Page preview (8.5 x 11)" : "Alternate format (4.5 x 11)"}>
      <svg role="img" aria-label={`${spec.widthIn} by ${spec.heightIn} inch page preview`} width={w + pad + 96} height={h + pad * 2} viewBox={`0 0 ${w + pad + 96} ${h + pad * 2}`} className="mx-auto block h-auto max-w-full">
        <rect x={pad} y={pad} width={w} height={h} fill="#fff" stroke="#8A94A6" />
        <g transform={`translate(${dx} ${dy})`}>
          <rect x={pad + inset} y={pad + top} width={Math.max(w - inset * 2, 0) * s} height={Math.max(h - top * 2, 0) * s} fill="#F3F6FC" stroke="#2457D6" strokeDasharray="4 3" />
          {(narrow ? ["AutoLabels", "Test Page"] : ["AutoLabels Test Page"]).map((line, i) => (
            <text key={line} x={pad + w / 2} y={pad + h / 2 - 6 + i * 15} textAnchor="middle" fontSize="12" fontWeight="600" fill="#1D2433">{line}</text>
          ))}
          {(narrow ? ["Margins match", "output"] : ["Margins match", "the printed output"]).map((line, i) => (
            <text key={line} x={pad + w / 2} y={pad + h / 2 + (narrow ? 26 : 14) + i * 14} textAnchor="middle" fontSize={narrow ? "10" : "12"} fill="#5B6578">{line}</text>
          ))}
          <Car x={pad + w / 2 - 22} y={pad + h / 2 + (narrow ? 66 : 54)} width={44} height={44} stroke="#B4BDCC" strokeWidth={1.25} fill="none" aria-hidden="true" />
        </g>
        <line x1={pad} y1={pad - 14} x2={pad + w} y2={pad - 14} stroke="#8A94A6" />
        <text x={pad + w / 2} y={pad - 19} textAnchor="middle" fontSize="12" fill="#1D2433">{spec.widthIn} in ({Math.round(spec.widthIn * 96)} px at 96 dpi)</text>
        <line x1={pad + w + 14} y1={pad} x2={pad + w + 14} y2={pad + h} stroke="#8A94A6" />
        <text x={pad + w + 20} y={pad + h / 2} fontSize="12" fill="#1D2433">
          <tspan x={pad + w + 20}>{spec.heightIn} in</tspan>
          <tspan x={pad + w + 20} dy="15">{Math.round(spec.heightIn * 96)} px</tspan>
          <tspan x={pad + w + 20} dy="15">at 96 dpi</tspan>
        </text>
      </svg>
      {footer}
    </AdminCard>
  );
};

export default function PrintCalibrationPage() {
  const { calibration, save, loading } = useDealerPrintSettings();
  const [draft, setDraft] = useState<PrintCalibration | null>(null);
  const [step, setStep] = useState<StepId>("measure");
  const [format, setFormat] = useState<StickerType>("window");
  const [saving, setSaving] = useState(false);
  const cal = draft ?? calibration;
  const set = (p: Partial<PrintCalibration>) => setDraft({ ...cal, ...p });
  const [customPrinter, setCustomPrinter] = useState(false);
  const savedPrinter = calibration.printerName?.trim() ?? "";
  const printerOptions = [
    { value: "none", label: "Not specified" },
    ...(savedPrinter ? [{ value: savedPrinter, label: savedPrinter }] : []),
    { value: "other", label: "Other printer" },
  ];
  const printerChoice = customPrinter ? "other" : cal.printerName?.trim() === savedPrinter && savedPrinter ? savedPrinter : cal.printerName?.trim() ? "other" : "none";

  const onSave = async () => {
    setSaving(true);
    const r = await save(cal);
    setSaving(false);
    if (r.ok) {
      setDraft(null);
      toast.success("Print settings saved");
    } else toast.error("Could not save print settings");
  };

  const printTest = () => {
    try {
      const key = `test-label-${crypto.randomUUID()}`;
      localStorage.setItem(key, JSON.stringify({ size: format, calibration: cal }));
      const w = window.open(`/print/test-label?h=${key}`, "_blank", "noopener");
      if (!w) toast.error("Allow pop-ups to open the test sheet");
    } catch {
      toast.error("Could not open the test sheet");
    }
  };

  return (
    <PageBody width="wide">
      <Crumbs items={[{ label: "Administration", to: "/admin" }, { label: "Documents & Service", to: adminTabHref("templates") }, { label: "Print & Calibration", to: adminTabHref("print-calibration") }, { label: "Printer Calibration" }]} />
      <PageHeader
        title="Printer Calibration"
        description="Calibrate printer settings to ensure accurate document layout and page boundaries."
      />
      {loading ? (
        <SkeletonBlock className="h-72 w-full" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)_minmax(0,1fr)] items-stretch [&>*]:h-full">
          <AdminCard inset="sm" flush>
            <div role="tablist" aria-label="Calibration steps" className="flex border-b border-adm-border px-4">
              {STEPS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={step === s.id}
                  onClick={() => setStep(s.id)}
                  className={cn("-mb-px h-11 flex-1 border-b-2 text-[14px] font-semibold whitespace-nowrap", step === s.id ? "border-adm-primary text-adm-primary" : "border-transparent text-adm-muted hover:text-adm-ink")}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-4 p-4">
              {step === "measure" && (
                <>
                  <p className="text-[13px] leading-[18px] text-adm-muted">Print a test page, then measure how far the printed border sits from the paper edge. Right and down are positive.</p>
                  <label className={labelCls}>
                    Paper format
                    <FilterSelect label="Paper format" className="h-10 w-full" value={format} onChange={(v) => setFormat(v as StickerType)} options={FORMATS.map((f) => ({ value: f.key, label: f.label }))} />
                  </label>
                  <label className={labelCls}>
                    Printer
                    <FilterSelect label="Printer" className="h-10 w-full" value={printerChoice} onChange={(v) => { setCustomPrinter(v === "other"); if (v === "none") set({ printerName: "" }); else if (v !== "other") set({ printerName: v }); }} options={printerOptions} />
                  </label>
                  {printerChoice === "other" && (
                    <label className={labelCls}>
                      Printer name
                      <input className={fieldCls} value={cal.printerName || ""} onChange={(e) => set({ printerName: e.target.value })} placeholder="Printer name, for example Lobby HP LaserJet" />
                    </label>
                  )}
                  <label className={labelCls}>
                    Profile
                    <FilterSelect label="Profile" className="h-10 w-full" value={format} onChange={(v) => setFormat(v as StickerType)} options={[{ value: "window", label: "Default (Letter)" }, { value: "addendum", label: "Half letter (addendum)" }]} />
                  </label>
                  <div className="grid grid-cols-[1.25fr_1.1fr_0.9fr] items-end gap-2">
                    <label className={labelCls}><span className="whitespace-nowrap">Horizontal offset (in)</span><input type="number" step="0.01" className={fieldCls} value={num(cal.xOffsetIn)} onChange={(e) => set({ xOffsetIn: parseFloat(e.target.value) })} /></label>
                    <label className={labelCls}><span className="whitespace-nowrap">Vertical offset (in)</span><input type="number" step="0.01" className={fieldCls} value={num(cal.yOffsetIn)} onChange={(e) => set({ yOffsetIn: parseFloat(e.target.value) })} /></label>
                    <label className={labelCls}>Scale (%)<input type="number" step="0.5" className={fieldCls} value={num(cal.scalePct)} onChange={(e) => set({ scalePct: parseFloat(e.target.value) })} /></label>
                  </div>
                  <button type="button" onClick={() => set({ xOffsetIn: DEFAULT_CALIBRATION.xOffsetIn, yOffsetIn: DEFAULT_CALIBRATION.yOffsetIn, scalePct: DEFAULT_CALIBRATION.scalePct })} className="self-start text-[14px] font-semibold text-adm-primary hover:underline">Reset to default</button>
                </>
              )}
              {step === "adjust" && (
                <>
                  <p className="text-[13px] leading-[18px] text-adm-muted">Set the safe area and what prints on the sheet. The preview on the right moves with your values.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={labelCls}>Top safe margin (in)<input type="number" step="0.05" className={fieldCls} value={num(cal.topSafeMarginIn)} onChange={(e) => set({ topSafeMarginIn: parseFloat(e.target.value) })} /></label>
                    <label className={labelCls}>Side safe margin (in)<input type="number" step="0.05" className={fieldCls} value={num(cal.leftSafeMarginIn)} onChange={(e) => set({ leftSafeMarginIn: parseFloat(e.target.value) })} /></label>
                  </div>
                  <label className={labelCls}>
                    Label stock
                    <select className={fieldCls} value={cal.labelMode} onChange={(e) => set({ labelMode: e.target.value as PrintCalibration["labelMode"] })}>
                      <option value="white">White label</option>
                      <option value="black">Black label</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-[14px] text-adm-ink"><input type="checkbox" checked={cal.showCropMarks} onChange={(e) => set({ showCropMarks: e.target.checked })} /> Show crop marks on print</label>
                  <label className="flex items-center gap-2 text-[14px] text-adm-ink"><input type="checkbox" checked={cal.showSafeArea} onChange={(e) => set({ showSafeArea: e.target.checked })} /> Show safe-area guide on print</label>
                </>
              )}
              {step === "save" && (
                <>
                  <p className="text-[13px] leading-[18px] text-adm-muted">Saving writes this profile for the dealership. It applies to every Sticker Studio print and PDF.</p>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-[14px] leading-[20px]">
                    <dt className="text-adm-muted">Offsets (x, y)</dt><dd>{num(cal.xOffsetIn)} in, {num(cal.yOffsetIn)} in</dd>
                    <dt className="text-adm-muted">Scale</dt><dd>{num(cal.scalePct)}%</dd>
                    <dt className="text-adm-muted">Safe margins</dt><dd>{num(cal.topSafeMarginIn)} in top, {num(cal.leftSafeMarginIn)} in sides</dd>
                    <dt className="text-adm-muted">Printer</dt><dd>{cal.printerName || "Unknown"}</dd>
                  </dl>
                  <div className="flex items-center gap-3">
                    <AdminButton variant="primary" onClick={onSave} disabled={saving}>{saving ? "Saving" : "Save settings"}</AdminButton>
                    {draft && <AdminButton variant="secondary" onClick={() => setDraft(null)}>Discard changes</AdminButton>}
                  </div>
                </>
              )}
              {step === "retest" && (
                <>
                  <p className="text-[13px] leading-[18px] text-adm-muted">Print another test page with the saved profile and confirm the border lands clean. Test sheets are not recorded; keep the printed sheet with its date.</p>
                  <label className={labelCls}>
                    Paper format
                    <FilterSelect label="Paper format" className="h-10 w-full" value={format} onChange={(v) => setFormat(v as StickerType)} options={FORMATS.map((f) => ({ value: f.key, label: f.label }))} />
                  </label>
                  <AdminButton variant="outline" className="self-start" onClick={printTest}>Print test page</AdminButton>
                </>
              )}
            </div>
          </AdminCard>
          <PagePreview type="window" cal={cal} footer={<AdminButton variant="primary" className="mt-4" onClick={printTest}>Print test page</AdminButton>} />
          <PagePreview type="addendum" cal={cal} />
        </div>
      )}
    </PageBody>
  );
}
