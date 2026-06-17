import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Printer, Upload, RotateCcw, Move } from "lucide-react";
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

const SIZE_PRESETS: { label: string; w: string; h: string }[] = [
  { label: 'Letter 8.5×11"', w: "8.5", h: "11" },
  { label: 'Legal 8.5×14"', w: "8.5", h: "14" },
  { label: 'Half 8.5×5.5"', w: "8.5", h: "5.5" },
  { label: 'Strip 4.25×11"', w: "4.25", h: "11" },
];

const DOC_ORDER: StickerDocType[] = ["new_window", "used_window", "new_addendum", "used_addendum"];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Representative vehicle block shown inside the content area so the dealer
// sees how live data will fill the white space. Scales to the box it's in.
function SampleVehicleBlock() {
  return (
    <div className="w-full h-full flex flex-col p-[2%] text-gray-900 leading-tight">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold" style={{ fontSize: "clamp(9px, 3.2cqw, 22px)" }}>2024 Honda Accord EX-L</div>
          <div className="text-gray-500" style={{ fontSize: "clamp(6px, 1.7cqw, 11px)" }}>
            VIN 1HGCV1F3XPA000000 · Stock #H4821
          </div>
        </div>
        <div className="text-right">
          <div className="font-extrabold text-gray-900" style={{ fontSize: "clamp(10px, 3.6cqw, 26px)" }}>$32,495</div>
          <div className="text-gray-500" style={{ fontSize: "clamp(6px, 1.7cqw, 11px)" }}>12,430 mi</div>
        </div>
      </div>
      <div className="mt-[3%] grid grid-cols-2 gap-x-[4%] gap-y-[1%] text-gray-700" style={{ fontSize: "clamp(6px, 1.6cqw, 10px)" }}>
        {["Backup Camera", "Heated Leather Seats", "Apple CarPlay", "Blind-Spot Monitor", "Moonroof", "Adaptive Cruise"].map((e) => (
          <div key={e}>• {e}</div>
        ))}
      </div>
      <div className="mt-auto flex items-end justify-between">
        <div className="text-gray-500" style={{ fontSize: "clamp(5px, 1.4cqw, 9px)" }}>Scan for full details &amp; history →</div>
        <div className="bg-gray-900 text-white grid place-items-center font-bold"
          style={{ width: "clamp(28px, 14cqw, 90px)", aspectRatio: "1", fontSize: "clamp(5px,1.4cqw,9px)" }}>
          QR
        </div>
      </div>
    </div>
  );
}

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

  return (
    <div className="bg-card rounded-lg p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-2">
        <Printer className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div>
          <h4 className="text-sm font-bold text-foreground">Window-sticker print templates</h4>
          <p className="text-[11px] text-muted-foreground">
            Set how each document physically prints onto your label stock. Print the full designed
            sticker on blank stock, or fill only the empty space on your own pre-printed stock.
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
          { v: "preprinted", t: "Pre-printed stock", d: "Fill the empty area on your own printed stock." },
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
          <input value={tpl.width} onChange={(e) => patch({ width: e.target.value })}
            className="w-20 px-2 py-1.5 border border-border-custom rounded text-sm bg-background text-foreground" placeholder="8.5" />
          <span className="text-muted-foreground text-sm">×</span>
          <input value={tpl.height} onChange={(e) => patch({ height: e.target.value })}
            className="w-20 px-2 py-1.5 border border-border-custom rounded text-sm bg-background text-foreground" placeholder="11" />
          <span className="text-[11px] text-muted-foreground">W × H</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SIZE_PRESETS.map((p) => (
            <button key={p.label} onClick={() => patch({ width: p.w, height: p.h })}
              className="px-2 py-1 rounded border border-border text-[11px] text-muted-foreground hover:bg-muted">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {tpl.mode === "blank" ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Blank stock prints the full AutoLabels-designed sticker at {tpl.width}×{tpl.height}". No
            alignment needed — switch to <span className="font-semibold">Pre-printed stock</span> to
            position the fill on your own label artwork.
          </p>
        </div>
      ) : (
        <>
          {/* Artwork upload */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Pre-printed stock artwork</label>
            <p className="text-[11px] text-muted-foreground">
              Upload a scan or image of your blank pre-printed label, then drag the box over the empty
              area you want AutoLabels to fill.
            </p>
            <div className="mt-1 flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-background text-xs font-semibold cursor-pointer hover:bg-muted/50 whitespace-nowrap">
                <Upload className="w-3.5 h-3.5" />
                {uploading ? "Uploading…" : tpl.artwork_url ? "Replace artwork" : "Upload artwork"}
                <input
                  type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading}
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
                <button onClick={() => patch({ artwork_url: "" })}
                  className="text-[11px] text-muted-foreground underline hover:text-foreground">Remove</button>
              )}
            </div>
          </div>

          {/* Interactive alignment canvas */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-label mb-1">
                Position the fill area
              </div>
              <div ref={canvasRef} className="relative w-full rounded border border-border bg-white select-none"
                style={{ aspectRatio: String(aspect), maxWidth: 480 }}>
                {tpl.artwork_url ? (
                  <img src={tpl.artwork_url} alt="Label artwork" className="absolute inset-0 w-full h-full object-fill pointer-events-none" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">
                    Upload artwork to align
                  </div>
                )}
                {/* Draggable content box */}
                <div
                  onPointerDown={startDrag("move")}
                  className="absolute border-2 border-teal bg-teal/10 cursor-move ring-1 ring-white/60"
                  style={{ left: `${area.x}%`, top: `${area.y}%`, width: `${area.width}%`, height: `${area.height}%` }}
                >
                  <div className="absolute -top-px left-1/2 -translate-x-1/2 -translate-y-full flex items-center gap-0.5 bg-teal text-primary-foreground text-[9px] font-semibold px-1.5 py-0.5 rounded-t">
                    <Move className="w-2.5 h-2.5" /> Fill area
                  </div>
                  <div className="w-full h-full overflow-hidden opacity-90 pointer-events-none">
                    <div style={{ containerType: "inline-size", width: "100%", height: "100%" } as React.CSSProperties}>
                      <SampleVehicleBlock />
                    </div>
                  </div>
                  {/* Resize handle */}
                  <div
                    onPointerDown={startDrag("resize")}
                    className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 rounded-sm bg-teal border-2 border-white cursor-nwse-resize"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Drag the box to move, drag the corner to resize. Sample data shown for alignment only.
              </p>
            </div>

            {/* Numeric controls */}
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-label">Fill area (% of label)</div>
              {([
                { k: "x" as const, l: "Left" },
                { k: "y" as const, l: "Top" },
                { k: "width" as const, l: "Width" },
                { k: "height" as const, l: "Height" },
              ]).map((f) => (
                <div key={f.k} className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-muted-foreground">{f.l}</span>
                  <input
                    type="number" min={0} max={100} value={Math.round(area[f.k])}
                    onChange={(e) => patchArea({ [f.k]: clamp(Number(e.target.value), 0, 100) } as Partial<StickerContentArea>)}
                    className="w-20 px-2 py-1 border border-border-custom rounded bg-background text-foreground"
                  />
                  <span className="text-[10px] text-muted-foreground">%</span>
                </div>
              ))}
              <button
                onClick={() => patchArea({ ...DEFAULT_CONTENT_AREA })}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-1"
              >
                <RotateCcw className="w-3 h-3" /> Reset fill area
              </button>
            </div>
          </div>

          {/* True-to-print preview */}
          {tpl.artwork_url && (
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-label mb-1">Print preview</div>
              <div style={{ containerType: "inline-size", maxWidth: 360 }}>
                <PrePrintedStickerFrame template={tpl} className="rounded border border-border shadow-sm">
                  <div style={{ containerType: "inline-size", width: "100%", height: "100%" } as React.CSSProperties}>
                    <SampleVehicleBlock />
                  </div>
                </PrePrintedStickerFrame>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
