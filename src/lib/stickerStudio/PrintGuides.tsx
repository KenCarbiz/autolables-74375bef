import type { PrintCalibration } from "./printConfig";

// Calibration overlays for the chrome-free print routes: corner + center
// registration (crop) marks and a dashed safe-area guide. Absolutely
// positioned inside a paper-sized, position:relative wrapper; pointer-events
// off so they never intercept clicks. Marks print because they sit inside the
// printed sheet area (edge-to-edge label stock has no bleed margin).
export function PrintGuides({
  widthIn, heightIn, cal,
}: {
  widthIn: number;
  heightIn: number;
  cal: Pick<PrintCalibration, "showCropMarks" | "showSafeArea" | "topSafeMarginIn" | "leftSafeMarginIn">;
}) {
  if (!cal.showCropMarks && !cal.showSafeArea) return null;
  const armIn = 0.28; // crop-mark arm length
  const ink = "#111827";
  const corner = (pos: React.CSSProperties, h: React.CSSProperties, v: React.CSSProperties) => (
    <>
      <div style={{ position: "absolute", background: ink, height: "1px", width: `${armIn}in`, ...pos, ...h }} />
      <div style={{ position: "absolute", background: ink, width: "1px", height: `${armIn}in`, ...pos, ...v }} />
    </>
  );
  return (
    <div className="print-guides" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden>
      {cal.showSafeArea && (
        <div style={{
          position: "absolute",
          top: `${cal.topSafeMarginIn}in`, bottom: `${cal.topSafeMarginIn}in`,
          left: `${cal.leftSafeMarginIn}in`, right: `${cal.leftSafeMarginIn}in`,
          border: "1px dashed #60a5fa",
        }} />
      )}
      {cal.showCropMarks && (
        <>
          {/* Four corners */}
          {corner({ top: 0, left: 0 }, {}, {})}
          {corner({ top: 0, right: 0 }, {}, {})}
          {corner({ bottom: 0, left: 0 }, {}, {})}
          {corner({ bottom: 0, right: 0 }, {}, {})}
          {/* Center marks on each edge */}
          <div style={{ position: "absolute", top: 0, left: `${widthIn / 2}in`, width: "1px", height: `${armIn}in`, background: ink, transform: "translateX(-0.5px)" }} />
          <div style={{ position: "absolute", bottom: 0, left: `${widthIn / 2}in`, width: "1px", height: `${armIn}in`, background: ink, transform: "translateX(-0.5px)" }} />
          <div style={{ position: "absolute", left: 0, top: `${heightIn / 2}in`, height: "1px", width: `${armIn}in`, background: ink, transform: "translateY(-0.5px)" }} />
          <div style={{ position: "absolute", right: 0, top: `${heightIn / 2}in`, height: "1px", width: `${armIn}in`, background: ink, transform: "translateY(-0.5px)" }} />
        </>
      )}
    </div>
  );
}
