import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  templateFromConfig, TemplateRenderer,
  type StickerData, type StickerBranding, type StickerTemplateConfig,
} from "@/lib/stickerStudio/templates";

// Chrome-free, public print surface for a sticker. The generator stashes the
// resolved template config + data + branding in localStorage under a one-time
// key and opens this route in a new tab; here we render the REAL template at
// true paper size and let the browser's native print-to-PDF produce a vector,
// pixel-identical document (real fonts, vector QR) — no html2canvas raster, no
// server render. The handoff key is consumed (removed) on read.

interface PrintPayload {
  config: StickerTemplateConfig;
  data: StickerData;
  branding: StickerBranding;
  autoprint?: boolean;
}

const StickerPrint = () => {
  const { templateId = "" } = useParams();
  const [params] = useSearchParams();
  const key = params.get("h") || "";
  const [payload, setPayload] = useState<PrintPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) localStorage.removeItem(key);
      if (!raw) { setMissing(true); return; }
      setPayload(JSON.parse(raw) as PrintPayload);
    } catch { setMissing(true); }
  }, [key]);

  // Size the printed page to the exact paper dimensions with zero margin so the
  // sheet prints edge-to-edge, and strip the on-screen ring/shadow.
  useEffect(() => {
    if (!payload) return;
    const { widthIn, heightIn } = payload.config;
    const style = document.createElement("style");
    style.setAttribute("data-sticker-print", "true");
    style.textContent = `
      @page { size: ${widthIn}in ${heightIn}in; margin: 0; }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        .sticker-print-sheet, .sticker-print-sheet * { box-shadow: none !important; }
        .sticker-print-sheet * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      }
    `;
    document.head.appendChild(style);
    let t: number | undefined;
    if (payload.autoprint !== false) {
      // Give fonts + the QR SVG a beat to settle before the print dialog opens.
      t = window.setTimeout(() => window.print(), 350);
    }
    return () => { document.head.removeChild(style); if (t) window.clearTimeout(t); };
  }, [payload]);

  const template = useMemo(() => (payload ? templateFromConfig(payload.config) : null), [payload]);

  if (missing) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 text-center bg-white">
        <div>
          <p className="text-sm font-semibold text-slate-900">Nothing to print</p>
          <p className="text-xs text-slate-500 mt-1">Open Print-perfect PDF from the Sticker Studio generator. (Template {templateId})</p>
        </div>
      </div>
    );
  }
  if (!template || !payload) return null;

  return (
    <div className="min-h-screen bg-white flex items-start justify-center p-0">
      <div className="sticker-print-sheet">
        <TemplateRenderer template={template} data={payload.data} branding={payload.branding} scale={1} />
      </div>
    </div>
  );
};

export default StickerPrint;
