import { useId } from "react";
import type { PrintCalibration } from "@/lib/stickerStudio/printConfig";
import type { StickerType } from "@/lib/stickerStudio/templates";
import { PAPER_FORMATS, adjustedRect, formatLength, paperRect, type Unit } from "@/lib/admin/printWizard";

const PAD_IN = 0.6;

/**
 * The page and the sheet border, drawn in inches. The adjusted border is the paper rectangle run through the
 * same transform the print CSS applies, so what moves here is what moves on paper. It is a drawing, not a
 * measurement: only a printed test sheet shows where a printer really lands the page.
 */
export const AlignmentPreview = ({ type, cal, unit, compact = false }: { type: StickerType; cal: PrintCalibration; unit: Unit; compact?: boolean }) => {
  const id = useId();
  const paper = paperRect(type);
  const adj = adjustedRect(type, cal);
  const x0 = Math.min(paper.x, adj.x) - PAD_IN;
  const y0 = Math.min(paper.y, adj.y) - PAD_IN;
  const x1 = Math.max(paper.x + paper.w, adj.x + adj.w) + PAD_IN;
  const y1 = Math.max(paper.y + paper.h, adj.y + adj.h) + PAD_IN;
  const format = PAPER_FORMATS.find((f) => f.type === type);
  const title = `${format?.name ?? type} ${format?.sizeLabel ?? ""}`.trim();
  const stroke = (n: number) => n / 26;
  const moved = adj.x !== 0 || adj.y !== 0 || cal.scalePct !== 100;
  const description = moved
    ? `Adjusted border starts ${formatLength(Math.abs(adj.x), unit)} ${adj.x >= 0 ? "right" : "left"} and ${formatLength(Math.abs(adj.y), unit)} ${adj.y >= 0 ? "down" : "up"} from the paper's top-left corner and measures ${formatLength(adj.w, unit)} by ${formatLength(adj.h, unit)}.`
    : "No adjustment. The expected and adjusted borders sit on the paper edge.";
  return (
    <figure className="min-w-0">
      <p className="mb-2 flex flex-wrap gap-x-5 text-[14px] leading-[20px] font-semibold text-adm-ink tabular-nums"><span>Width {formatLength(paper.w, unit)}</span><span>Height {formatLength(paper.h, unit)}</span></p>
      <svg
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
        viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}
        className="block w-full h-auto mx-auto rounded-lg bg-adm-workspace"
        style={{ maxHeight: compact ? 280 : 520 }}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={`${id}-t`}>{`${title} page preview`}</title>
        <desc id={`${id}-d`}>{description}</desc>
        <rect x={paper.x} y={paper.y} width={paper.w} height={paper.h} fill="#FFFFFF" stroke="#8A94A6" strokeWidth={stroke(1.5)} data-layer="paper-edge" />
        <rect x={paper.x} y={paper.y} width={paper.w} height={paper.h} fill="none" stroke="#2457D6" strokeWidth={stroke(1.5)} strokeDasharray={`${stroke(6)} ${stroke(4)}`} data-layer="expected-border" />
        <g data-layer="adjusted-border">
          <rect x={adj.x} y={adj.y} width={adj.w} height={adj.h} fill="#E8EEFC" fillOpacity={0.55} stroke="#C2410C" strokeWidth={stroke(2.5)} />
          <line x1={adj.x + adj.w / 2} y1={adj.y} x2={adj.x + adj.w / 2} y2={adj.y + adj.h} stroke="#C2410C" strokeOpacity={0.45} strokeWidth={stroke(1)} />
          <line x1={adj.x} y1={adj.y + adj.h / 2} x2={adj.x + adj.w} y2={adj.y + adj.h / 2} stroke="#C2410C" strokeOpacity={0.45} strokeWidth={stroke(1)} />
        </g>
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px] leading-[18px] text-adm-ink">
        <span className="inline-flex items-center gap-2"><svg width="24" height="12" aria-hidden="true"><line x1="0" y1="6" x2="24" y2="6" stroke="#8A94A6" strokeWidth="2" /></svg>Paper edge</span>
        <span className="inline-flex items-center gap-2"><svg width="24" height="12" aria-hidden="true"><line x1="0" y1="6" x2="24" y2="6" stroke="#2457D6" strokeWidth="2" strokeDasharray="6 4" /></svg>Expected border</span>
        <span className="inline-flex items-center gap-2"><svg width="24" height="12" aria-hidden="true"><line x1="0" y1="6" x2="24" y2="6" stroke="#C2410C" strokeWidth="3" /></svg>Adjusted border</span>
      </figcaption>
      <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">{description} Drawn to the paper's real size. Print a test sheet to see where the printer lands the page.</p>
    </figure>
  );
};
