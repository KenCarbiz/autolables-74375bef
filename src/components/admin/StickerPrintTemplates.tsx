import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Printer, Upload, RotateCcw } from "lucide-react";
import {
  useDealerSettings,
  STICKER_DOC_LABELS,
  DEFAULT_STICKER_TEMPLATE,
  DEFAULT_STICKER_FIELDS,
  type StickerDocType,
  type StickerPrintTemplate,
  type StickerFieldPosition,
} from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { uploadPhoto } from "@/lib/storage";

// Sample values used only to render the live alignment preview.
const SAMPLE: Record<string, string> = {
  ymm: "2024 Honda Accord",
  trim: "EX-L Sedan",
  price: "$32,495",
  mileage: "12,430 mi",
  stock: "Stock #H4821",
  vin: "1HGCV1F3XPA000000",
};

const SIZE_PRESETS: { label: string; w: string; h: string }[] = [
  { label: 'Letter 8.5×11"', w: "8.5", h: "11" },
  { label: 'Legal 8.5×14"', w: "8.5", h: "14" },
  { label: 'Half 8.5×5.5"', w: "8.5", h: "5.5" },
  { label: 'Strip 4.25×11"', w: "4.25", h: "11" },
];

const DOC_ORDER: StickerDocType[] = ["new_window", "used_window", "new_addendum", "used_addendum"];

export default function StickerPrintTemplates() {
  const { settings, updateSettings } = useDealerSettings();
  const { tenant, currentStore } = useTenant();
  const [active, setActive] = useState<StickerDocType>("new_window");
  const [uploading, setUploading] = useState(false);

  const templates = settings.sticker_print_templates;
  const tpl: StickerPrintTemplate = templates?.[active] ?? DEFAULT_STICKER_TEMPLATE;

  const save = (next: StickerPrintTemplate) => {
    updateSettings({
      sticker_print_templates: { ...templates, [active]: next },
    });
  };

  const patch = (p: Partial<StickerPrintTemplate>) => save({ ...tpl, ...p });

  const patchField = (idx: number, p: Partial<StickerFieldPosition>) => {
    const fields = tpl.fields.map((f, i) => (i === idx ? { ...f, ...p } : f));
    save({ ...tpl, fields });
  };

  const aspect = useMemo(() => {
    const w = parseFloat(tpl.width) || 8.5;
    const h = parseFloat(tpl.height) || 11;
    return w / h;
  }, [tpl.width, tpl.height]);

  return (
    <div className="bg-card rounded-lg p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-2">
        <Printer className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <h4 className="text-sm font-bold text-foreground">Window-sticker print templates</h4>
          <p className="text-[11px] text-muted-foreground">
            Set how each document physically prints onto your label stock. Print the full designed
            sticker on blank stock, or overlay only the vehicle data onto your own pre-printed stock.
          </p>
        </div>
      </div>

      {/* Document-type selector */}
      <div className="flex flex-wrap gap-1.5">
        {DOC_ORDER.map((d) => (
          <button
            key={d}
            onClick={() => setActive(d)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              active === d
                ? "bg-teal text-primary-foreground border-teal"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {STICKER_DOC_LABELS[d]}
          </button>
        ))}
      </div>

      {/* Mode */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {([
          { v: "blank", t: "Blank label stock", d: "Print the full designed sticker." },
          { v: "preprinted", t: "Pre-printed stock", d: "Overlay only the vehicle data into fixed positions." },
        ] as const).map((m) => (
          <button
            key={m.v}
            onClick={() => patch({ mode: m.v })}
            className={`text-left p-3 rounded-lg border transition-colors ${
              tpl.mode === m.v ? "border-teal bg-teal/5 ring-1 ring-teal" : "border-border bg-background hover:bg-muted"
            }`}
          >
            <div className="text-xs font-bold text-foreground">{m.t}</div>
            <div className="text-[11px] text-muted-foreground">{m.d}</div>
          </button>
        ))}
      </div>

      {/* Label size */}
      <div>
        <label className="text-xs font-semibold text-muted-foreground">Label size (inches)</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            value={tpl.width}
            onChange={(e) => patch({ width: e.target.value })}
            className="w-20 px-2 py-1.5 border border-border-custom rounded text-sm bg-background text-foreground"
            placeholder="8.5"
          />
          <span className="text-muted-foreground text-sm">×</span>
          <input
            value={tpl.height}
            onChange={(e) => patch({ height: e.target.value })}
            className="w-20 px-2 py-1.5 border border-border-custom rounded text-sm bg-background text-foreground"
            placeholder="11"
          />
          <span className="text-[11px] text-muted-foreground">W × H</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SIZE_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => patch({ width: p.w, height: p.h })}
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:bg-muted"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pre-printed artwork upload */}
      {tpl.mode === "preprinted" && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Pre-printed stock artwork</label>
          <p className="text-[11px] text-muted-foreground">
            Upload a scan or image of your blank pre-printed label so you can align the data positions below.
          </p>
          <div className="mt-1 flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-background text-xs font-semibold cursor-pointer hover:bg-muted/50 whitespace-nowrap">
              <Upload className="w-3.5 h-3.5" />
              {uploading ? "Uploading…" : "Upload artwork"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={uploading}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploading(true);
                  try {
                    const result = await uploadPhoto("dealer-logos", f, {
                      tenantId: tenant?.id,
                      storeId: currentStore?.id,
                      vin: "sticker-artwork",
                    });
                    if (result?.url) {
                      patch({ artwork_url: result.url });
                      toast.success("Artwork uploaded");
                    }
                  } catch (err) {
                    toast.error(`Upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
                  } finally {
                    setUploading(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
            {tpl.artwork_url && (
              <button
                onClick={() => patch({ artwork_url: "" })}
                className="text-[11px] text-muted-foreground underline hover:text-foreground"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      {/* Live preview + field positions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-border-custom">
        {/* Preview */}
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-label mb-1">Preview</div>
          <div
            className="relative w-full overflow-hidden rounded border border-border bg-white"
            style={{ aspectRatio: String(aspect) }}
          >
            {tpl.mode === "preprinted" && tpl.artwork_url && (
              <img src={tpl.artwork_url} alt="Label artwork" className="absolute inset-0 w-full h-full object-contain" />
            )}
            {tpl.mode === "blank" && !tpl.artwork_url && (
              <div className="absolute inset-2 border border-dashed border-gray-300 rounded" />
            )}
            {tpl.fields.filter((f) => f.enabled).map((f) => (
              <div
                key={f.key}
                className="absolute -translate-y-1/2 whitespace-nowrap font-semibold text-gray-900 leading-none"
                style={{
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  // Scale point size into the preview box (rough visual guide).
                  fontSize: `${Math.max(7, f.size * 0.62)}px`,
                }}
              >
                {SAMPLE[f.key] ?? f.label}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Positions are a percentage of the label. Sample data shown for alignment only.
          </p>
        </div>

        {/* Field controls */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-label">Data fields</div>
          {tpl.fields.map((f, idx) => (
            <div key={f.key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => patchField(idx, { enabled: e.target.checked })}
                className="shrink-0"
              />
              <span className="w-32 shrink-0 truncate text-foreground" title={f.label}>{f.label}</span>
              <label className="text-[10px] text-muted-foreground">X</label>
              <input
                type="number" min={0} max={100} value={f.x}
                onChange={(e) => patchField(idx, { x: Number(e.target.value) })}
                className="w-14 px-1.5 py-1 border border-border-custom rounded bg-background text-foreground"
              />
              <label className="text-[10px] text-muted-foreground">Y</label>
              <input
                type="number" min={0} max={100} value={f.y}
                onChange={(e) => patchField(idx, { y: Number(e.target.value) })}
                className="w-14 px-1.5 py-1 border border-border-custom rounded bg-background text-foreground"
              />
              <label className="text-[10px] text-muted-foreground">pt</label>
              <input
                type="number" min={6} max={72} value={f.size}
                onChange={(e) => patchField(idx, { size: Number(e.target.value) })}
                className="w-14 px-1.5 py-1 border border-border-custom rounded bg-background text-foreground"
              />
            </div>
          ))}
          <button
            onClick={() => save({ ...tpl, fields: DEFAULT_STICKER_FIELDS.map((f) => ({ ...f })) })}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-1"
          >
            <RotateCcw className="w-3 h-3" />
            Reset field positions
          </button>
        </div>
      </div>
    </div>
  );
}
