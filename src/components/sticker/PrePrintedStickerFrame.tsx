import { ReactNode, CSSProperties } from "react";
import type { StickerPrintTemplate } from "@/contexts/DealerSettingsContext";

// Renders a pre-printed label: the dealer's uploaded stock artwork as a
// full-bleed background, with the vehicle data block (children) flowed into
// the configured content area. Used both by the Admin alignment preview and
// the live print output so what the dealer aligns is what prints.
export function PrePrintedStickerFrame({
  template,
  children,
  className = "",
  style,
}: {
  template: StickerPrintTemplate;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const w = parseFloat(template.width) || 8.5;
  const h = parseFloat(template.height) || 11;
  const area = template.content_area;

  return (
    <div
      className={`relative bg-white overflow-hidden ${className}`}
      style={{ aspectRatio: String(w / h), ...style }}
    >
      {template.artwork_url && (
        <img
          src={template.artwork_url}
          alt=""
          className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none"
        />
      )}
      <div
        className="absolute overflow-hidden"
        style={{
          left: `${area.x}%`,
          top: `${area.y}%`,
          width: `${area.width}%`,
          height: `${area.height}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
