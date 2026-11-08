import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Move } from "lucide-react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, INPUT_CLASS, SectionCard, SwitchField } from "@/components/admin/v3/editor";
import {
  useDealerSettings,
  STICKER_DOC_LABELS,
  DEFAULT_STICKER_TEMPLATE,
  DEFAULT_CONTENT_AREA,
  type StickerDocType,
  type StickerPrintTemplate,
  type StickerContentArea,
} from "@/contexts/DealerSettingsContext";
import { useTenant } from "@/contexts/TenantContext";
import { uploadPhoto } from "@/lib/storage";
import { PrePrintedStickerFrame } from "@/components/sticker/PrePrintedStickerFrame";
import { StickerFillBlock, type StickerFillData } from "@/components/sticker/StickerFillBlock";

const SAMPLE_FILL: StickerFillData = {
  ymm: "2024 Honda Accord EX-L",
  vin: "1HGCV1F3XPA000000",
  stock: "H4821",
  mileage: "12,430",
  price: "$32,495",
  equipment: ["Backup Camera", "Heated Leather Seats", "Apple CarPlay", "Blind-Spot Monitor", "Moonroof", "Adaptive Cruise"],
  qrUrl: "https://autolabels.io",
};

const SIZE_PRESETS: { label: string; w: string; h: string }[] = [
  { label: 'Letter 8.5×11"', w: "8.5", h: "11" },
  { label: 'Legal 8.5×14"', w: "8.5", h: "14" },
  { label: 'Half 8.5×5.5"', w: "8.5", h: "5.5" },
  { label: 'Strip 4.25×11"', w: "4.25", h: "11" },
];

const DOC_ORDER: StickerDocType[] = ["new_window", "used_window", "new_addendum", "used_addendum"];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function StickerPrintTemplates() {
  const { settings, updateSettings } = useDealerSettings();
  const { tenant, currentStore } = useTenant();
  const [active, setActive] = useState<StickerDocType>("used_window");
  const [uploading, setUploading] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const templates = settings.sticker_print_templates;
  const tpl: StickerPrintTemplate = templates?.[active] ?? DEFAULT_STICKER_TEMPLATE;
  const area = tpl.content_area ?? DEFAULT_CONTENT_AREA;

  const save = (next: StickerPrintTemplate) => {
    updateSettings({ sticker_print_templates: { ...templates, [active]: next } });
  };
  const patch = (p: Partial<StickerPrintTemplate>) => save({ ...tpl, ...p });
  const patchArea = (p: Partial<StickerContentArea>) => save({ ...tpl, content_area: { ...area, ...p } });

  const aspect = useMemo(() => {
    const w = parseFloat(tpl.width) || 8.5;
    const h = parseFloat(tpl.height) || 11;
    return w / h;
  }, [tpl.width, tpl.height]);

  // Pointer drag/resize of the content box, in % of the canvas. Handlers are
  // scoped to each drag session so add/removeEventListener match by identity.
  const startDrag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { sx: e.clientX, sy: e.clientY, area: { ...area } };
    const move = (ev: PointerEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dxPct = ((ev.clientX - start.sx) / rect.width) * 100;
      const dyPct = ((ev.clientY - start.sy) / rect.height) * 100;
      if (mode === "move") {
        patchArea({
          x: clamp(start.area.x + dxPct, 0, 100 - start.area.width),
          y: clamp(start.area.y + dyPct, 0, 100 - start.area.height),
        });
      } else {
        patchArea({
          width: clamp(start.area.width + dxPct, 10, 100 - start.area.x),
          height: clamp(start.area.height + dyPct, 8, 100 - start.area.y),
        });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pill = (on: boolean) => `inline-flex items-center justify-center min-h-[44px] px-4 rounded-full border text-[14px] leading-[20px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary ${on ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace"}`;
  const FIELD = "block text-[14px] leading-[20px] font-semibold text-adm-ink";
  const HELP = "text-[13px] leading-[18px] text-adm-muted";

  return (
    <SectionCard
      id="sticker-print-templates"
      icon="printer"
      title="Window-sticker print templates"
      description="Set how each document physically prints onto your label stock. Print the full designed sticker on blank stock, or fill only the empty space on your own pre-printed stock."
    >
      <div role="group" aria-label="Document type" className="flex flex-wrap gap-2">
        {DOC_ORDER.map((d) => (
          <button key={d} type="button" aria-pressed={active === d} onClick={() => setActive(d)} className={pill(active === d)}>
            {STICKER_DOC_LABELS[d]}
          </button>
        ))}
      </div>

      <div role="group" aria-label="Stock type" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([
          { v: "blank", t: "Blank label stock", d: "Print the full designed sticker." },
          { v: "preprinted", t: "Pre-printed stock", d: "Fill the empty area on your own printed stock." },
        ] as const).map((m) => (
          <button
            key={m.v}
            type="button"
            aria-pressed={tpl.mode === m.v}
            onClick={() => patch({ mode: m.v })}
            className={`text-left px-4 py-3 min-h-[64px] rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary ${tpl.mode === m.v ? "border-adm-primary bg-adm-selected" : "border-adm-border bg-adm-surface hover:bg-adm-workspace"}`}
          >
            <span className="block text-[15px] leading-[22px] font-semibold text-adm-ink">{m.t}</span>
            <span className={`block ${HELP}`}>{m.d}</span>
          </button>
        ))}
      </div>

      <div>
        <span id="label-size-h" className={FIELD}>Label size (inches)</span>
        <div className="mt-1.5 flex items-center gap-2 flex-wrap" role="group" aria-labelledby="label-size-h">
          <input aria-label="Label width in inches" inputMode="decimal" value={tpl.width} onChange={(e) => patch({ width: e.target.value })} className={`${INPUT_CLASS} !w-24`} placeholder="8.5" />
          <span aria-hidden="true" className="text-adm-muted">x</span>
          <input aria-label="Label height in inches" inputMode="decimal" value={tpl.height} onChange={(e) => patch({ height: e.target.value })} className={`${INPUT_CLASS} !w-24`} placeholder="11" />
          <span className={HELP}>Width by height</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SIZE_PRESETS.map((p) => (
            <AdminButton key={p.label} size="sm" className="min-h-[44px] sm:min-h-[32px]" onClick={() => patch({ width: p.w, height: p.h })}>{p.label}</AdminButton>
          ))}
        </div>
      </div>

      {tpl.mode === "blank" ? (
        <div className="rounded-lg border border-dashed border-adm-border bg-adm-workspace p-4">
          <p className="text-[14px] leading-[20px] text-adm-muted">
            Blank stock prints the full AutoLabels-designed sticker at {tpl.width}x{tpl.height} inches. No alignment needed. Switch to <span className="font-semibold text-adm-ink">Pre-printed stock</span> to position the fill on your own label artwork.
          </p>
        </div>
      ) : (
        <>
          <div>
            <span className={FIELD}>Pre-printed stock artwork</span>
            <p className={HELP}>Upload a scan or image of your blank pre-printed label, then drag the box over the empty area you want AutoLabels to fill.</p>
            <div className="mt-2 flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-md border border-adm-border bg-adm-surface text-[14px] leading-[20px] font-semibold text-adm-ink cursor-pointer hover:bg-adm-workspace whitespace-nowrap focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-adm-primary">
                <AdminIcon name="upload" />
                {uploading ? "Uploading…" : tpl.artwork_url ? "Replace artwork" : "Upload artwork"}
                <input
                  type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setUploading(true);
                    try {
                      const result = await uploadPhoto("dealer-logos", f, {
                        tenantId: tenant?.id, storeId: currentStore?.id, vin: "sticker-artwork",
                      });
                      if (result?.url) { patch({ artwork_url: result.url }); toast.success("Artwork uploaded"); }
                    } catch (err) {
                      toast.error(`Upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
                    } finally { setUploading(false); e.target.value = ""; }
                  }}
                />
              </label>
              {tpl.artwork_url && (
                <AdminButton size="sm" variant="ghost" className="min-h-[44px] sm:min-h-[32px]" onClick={() => patch({ artwork_url: "" })}>Remove artwork</AdminButton>
              )}
            </div>
          </div>

          <div>
            <span className={FIELD}>Fill content</span>
            <p className={HELP}>Vehicle ID and the QR always print. Choose what else fills the area.</p>
            <div className="mt-1 divide-y divide-adm-divider rounded-lg border border-adm-divider px-3.5">
              <div className="py-1"><SwitchField label="Equipment list" checked={!!tpl.fill_equipment} onChange={(v) => patch({ fill_equipment: v })} /></div>
              <div className="py-1"><SwitchField label="Pricing" checked={!!tpl.fill_pricing} onChange={(v) => patch({ fill_pricing: v })} /></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-5">
            <div>
              <p className={`${FIELD} mb-1.5`}>Position the fill area</p>
              {/* Literal white: this canvas stands in for printed paper, so it must not follow the theme surface. */}
              <div ref={canvasRef} className="relative w-full rounded border border-adm-border bg-white select-none"
                style={{ aspectRatio: String(aspect), maxWidth: 480 }}>
                {tpl.artwork_url ? (
                  <img src={tpl.artwork_url} alt="Label artwork" className="absolute inset-0 w-full h-full object-fill pointer-events-none" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-[13px] text-adm-muted">
                    Upload artwork to align
                  </div>
                )}
                <div
                  onPointerDown={startDrag("move")}
                  className="absolute border-2 border-adm-primary bg-adm-primary/10 cursor-move ring-1 ring-white/60"
                  style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.width}%`, height: `${area.height}%` }}
                >
                  <div className="absolute -top-px left-1/2 -translate-x-1/2 -translate-y-full flex items-center gap-1 bg-adm-primary text-white text-[13px] leading-[18px] font-semibold px-2 py-0.5 rounded-t whitespace-nowrap">
                    <Move className="w-3.5 h-3.5" /> Fill area
                  </div>
                  <div className="w-full h-full overflow-hidden opacity-90 pointer-events-none">
                    <div style={{ containerType: "inline-size", width: "100%", height: "100%" } as React.CSSProperties}>
                      <StickerFillBlock data={SAMPLE_FILL} showEquipment={tpl.fill_equipment} showPricing={tpl.fill_pricing} />
                    </div>
                  </div>
                  <div
                    onPointerDown={startDrag("resize")}
                    className="absolute -right-2 -bottom-2 w-5 h-5 rounded-sm bg-adm-primary border-2 border-white cursor-nwse-resize"
                  />
                </div>
              </div>
              <p className={`${HELP} mt-1.5`}>Drag the box to move, drag the corner to resize. Sample data shown for alignment only.</p>
            </div>

            <div className="space-y-2">
              <p className={FIELD}>Fill area (% of label)</p>
              {([
                { k: "x" as const, l: "Left" },
                { k: "y" as const, l: "Top" },
                { k: "width" as const, l: "Width" },
                { k: "height" as const, l: "Height" },
              ]).map((f) => (
                <div key={f.k} className="flex items-center gap-2 text-[14px] leading-[20px]">
                  <label htmlFor={`fill-${f.k}`} className="w-16 text-adm-muted">{f.l}</label>
                  <input
                    id={`fill-${f.k}`}
                    type="number" min={0} max={100} value={Math.round(area[f.k])}
                    onChange={(e) => patchArea({ [f.k]: clamp(Number(e.target.value), 0, 100) } as Partial<StickerContentArea>)}
                    className={`${INPUT_CLASS} !w-24`}
                  />
                  <span className={HELP}>%</span>
                </div>
              ))}
              <AdminButton size="sm" className="min-h-[44px] sm:min-h-[32px]" onClick={() => patchArea({ ...DEFAULT_CONTENT_AREA })}>
                <AdminIcon name="rotate" /> Reset fill area
              </AdminButton>
            </div>
          </div>

          {tpl.artwork_url && (
            <div>
              <p className={`${FIELD} mb-1.5`}>Print preview</p>
              <div style={{ containerType: "inline-size", maxWidth: 360 }}>
                <PrePrintedStickerFrame template={tpl} className="rounded border border-adm-border shadow-sm">
                  <div style={{ containerType: "inline-size", width: "100%", height: "100%" } as React.CSSProperties}>
                    <StickerFillBlock data={SAMPLE_FILL} showEquipment={tpl.fill_equipment} showPricing={tpl.fill_pricing} />
                  </div>
                </PrePrintedStickerFrame>
              </div>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
