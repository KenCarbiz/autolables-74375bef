import type { GaugeSegment, IndicatorState } from "@/lib/intelligence/marketPass/contracts";
import { GAUGE_NEUTRAL_TRACK, GAUGE_UNAVAILABLE_TEXT } from "@/lib/intelligence/marketPass/contracts";

export interface GaugeIndicator {
  state: IndicatorState;
  label: string;
  explanation: string;
  segments: GaugeSegment[];
  segmentIndex: number | null;
  ariaLabel: string;
}

const CX = 60;
const CY = 58;
const R = 46;
const STROKE = 11;
const GAP_DEG = 4;

const point = (deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: +(CX + R * Math.cos(rad)).toFixed(2), y: +(CY - R * Math.sin(rad)).toFixed(2) };
};

/** SVG path for segment i of n on a left-to-right half circle, least favorable on the left. */
export function arcSegmentPath(i: number, n: number): string {
  const span = 180 / n;
  const start = point(180 - i * span - (i === 0 ? 0 : GAP_DEG / 2));
  const end = point(180 - (i + 1) * span + (i === n - 1 ? 0 : GAP_DEG / 2));
  return `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`;
}

/** A segment is lit only for a rated state; qualified and unavailable never light one, so they can never show green. */
export function litSegment(ind: Pick<GaugeIndicator, "state" | "segmentIndex" | "segments">): number | null {
  if (ind.segmentIndex == null) return null;
  if (ind.state !== "assessed" && ind.state !== "adverse" && ind.state !== "review") return null;
  return ind.segmentIndex >= 0 && ind.segmentIndex < ind.segments.length ? ind.segmentIndex : null;
}

export default function SegmentedArcGauge({ title, indicator }: { title: string; indicator: GaugeIndicator }) {
  const lit = litSegment(indicator);
  const n = indicator.segments.length;
  const litColor = lit != null ? indicator.segments[lit].color : null;
  return (
    <figure className="flex flex-col items-center text-center" data-gauge={title} data-state={indicator.state} data-segment-index={lit ?? ""}>
      <svg viewBox="0 0 120 66" width="148" height="81" role="img" aria-label={indicator.ariaLabel}>
        {indicator.segments.map((s, i) => (
          <path
            key={s.index}
            d={arcSegmentPath(i, n)}
            fill="none"
            stroke={i === lit ? s.color : GAUGE_NEUTRAL_TRACK}
            strokeWidth={STROKE}
            strokeLinecap="butt"
            data-segment={i}
            data-lit={i === lit ? "true" : "false"}
          />
        ))}
      </svg>
      <figcaption className="mt-1">
        <span className="block text-gray-500 uppercase tracking-wide font-semibold" style={{ fontSize: "10px" }}>{title}</span>
        <span
          className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-bold leading-tight"
          style={{ color: lit == null ? GAUGE_UNAVAILABLE_TEXT : "#111827" }}
          data-gauge-label
        >
          {litColor && <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: litColor }} />}
          {indicator.label}
        </span>
      </figcaption>
    </figure>
  );
}
