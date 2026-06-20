import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { buildPrintCss, normalizeCalibration, PAPER, type PrintCalibration } from "@/lib/stickerStudio/printConfig";
import { PrintGuides } from "@/lib/stickerStudio/PrintGuides";
import type { StickerType } from "@/lib/stickerStudio/templates";

// Chrome-free calibration sheet at /print/test-label. The print-settings
// calibration wizard stashes { size, calibration } under a one-time localStorage
// key and opens this route in a new tab. Renders a ruled test target — border
// box, corner + center marks, a QR test block with quiet zone, and readable
// text samples — so a dealer can measure how their printer lands the sheet on
// physical label stock and dial in the offset/scale values.

interface TestPayload {
  size: StickerType;
  calibration?: Partial<PrintCalibration>;
  autoprint?: boolean;
}

const StickerTestLabel = () => {
  const [params] = useSearchParams();
  const key = params.get("h") || "";
  // Fallback to query params so the route also works when opened directly.
  const sizeParam = (params.get("size") as StickerType) || "window";
  const modeParam = params.get("mode") === "black" ? "black" : "white";
  const [payload, setPayload] = useState<TestPayload | null>(null);

  useEffect(() => {
    try {
      const raw = key ? localStorage.getItem(key) : null;
      if (raw) { localStorage.removeItem(key); setPayload(JSON.parse(raw) as TestPayload); return; }
      setPayload({ size: sizeParam === "addendum" ? "addendum" : "window", calibration: { labelMode: modeParam } });
    } catch {
      setPayload({ size: "window", calibration: { labelMode: "white" } });
    }
  }, [key, sizeParam, modeParam]);

  const cal = useMemo(() => normalizeCalibration(payload?.calibration), [payload]);

  useEffect(() => {
    if (!payload) return;
    const style = document.createElement("style");
    style.setAttribute("data-test-label-print", "true");
    style.textContent = buildPrintCss(payload.size, cal);
    document.head.appendChild(style);
    let t: number | undefined;
    if (payload.autoprint !== false) t = window.setTimeout(() => window.print(), 350);
    return () => { document.head.removeChild(style); if (t) window.clearTimeout(t); };
  }, [payload, cal]);

  if (!payload) return null;
  const paper = PAPER[payload.size];
  const dark = cal.labelMode === "black";
  const ink = dark ? "#f5f7fa" : "#0f172a";
  const sub = dark ? "#aab3c2" : "#475569";
  const sheetBg = dark ? "#0b0f17" : "#ffffff";
  const border = dark ? "#3b4554" : "#111827";

  return (
    <div className="min-h-screen flex items-start justify-center p-0" style={{ background: dark ? "#1f2937" : "#ffffff" }}>
      <div
        className="sticker-print-sheet"
        style={{ position: "relative", width: `${paper.widthIn}in`, height: `${paper.heightIn}in`, background: sheetBg, color: ink }}
      >
        {/* Outer border box */}
        <div style={{ position: "absolute", inset: 0, border: `1.5px solid ${border}` }} />

        <div style={{ padding: "0.5in", height: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em" }}>CALIBRATION TEST · {paper.widthIn}×{paper.heightIn}</p>
            <p style={{ fontSize: 11, color: sub }}>{dark ? "Black label" : "White label"} · offset {cal.xOffsetIn}in / {cal.yOffsetIn}in · scale {cal.scalePct}%</p>
          </div>

          {/* Center crosshair */}
          <div style={{ position: "relative", flex: 1, marginTop: "0.3in" }}>
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: "1px", background: border }} />
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "1px", background: border }} />
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "0.5in", height: "0.5in", border: `1px solid ${border}`, borderRadius: "9999px" }} />
          </div>

          {/* QR test block with quiet zone */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "0.4in" }}>
            <div style={{ fontSize: 11, color: sub, lineHeight: 1.5 }}>
              <p style={{ fontWeight: 700, color: ink }}>Readability check</p>
              <p>The quick brown fox · 0123456789</p>
              <p style={{ fontFamily: "monospace" }}>VIN 5N1AL1F87VC331335 · STK I21567</p>
              <p style={{ fontSize: 8, color: sub }}>8pt disclaimer line — must remain legible after printing.</p>
            </div>
            <div style={{ textAlign: "center" }}>
              {/* QR always sits in a white quiet-zone box, even on black stock */}
              <div style={{ background: "#fff", padding: "0.16in", border: `1px solid ${border}` }}>
                <QRCodeSVG value="https://autolabels.io/print-test" size={92} level="M" />
              </div>
              <p style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: sub, marginTop: 2 }}>Scan test</p>
            </div>
          </div>
        </div>

        {/* Force crop + safe-area marks on so the test sheet always shows them */}
        <PrintGuides widthIn={paper.widthIn} heightIn={paper.heightIn} cal={{ ...cal, showCropMarks: true, showSafeArea: true }} />
      </div>
    </div>
  );
};

export default StickerTestLabel;
