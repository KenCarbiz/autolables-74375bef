import { type LucideIcon } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// TableEmptyState (Wave 14.5)
//
// Linear/Vercel-style empty state used inside platform tables
// when a query returns zero rows. Monochrome line illustration
// (a single lucide icon scaled up, stroke-1 to match the
// interface's stroke weight), single title, one-sentence
// description, and an optional verb-CTA.
//
// Drop-in: <TableEmptyState icon={Users} title="..."
//          description="..." ctaLabel="..." onCta={...} />
// ──────────────────────────────────────────────────────────────

interface Props {
  icon: LucideIcon;
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
  // When set, renders the panel inside the table card itself
  // (used by platform tables that wrap their body in a bordered
  // card already). When false the component supplies its own
  // border.
  inset?: boolean;
}

export const TableEmptyState = ({
  icon: Icon,
  title,
  description,
  ctaLabel,
  onCta,
  inset = false,
}: Props) => {
  const outer = inset
    ? "py-14 px-6"
    : "py-14 px-6 rounded-xl border border-border bg-card";
  return (
    <div className={`${outer} text-center flex flex-col items-center gap-3`}>
      <div className="w-14 h-14 rounded-2xl bg-muted/50 border border-border flex items-center justify-center">
        <Icon className="w-7 h-7 text-muted-foreground" strokeWidth={1.25} />
      </div>
      <div className="max-w-md mx-auto">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={onCta}
          className="mt-1 inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-gradient-to-r from-[#3BB4FF] to-[#1E90FF] text-white text-xs font-display font-black shadow-premium hover:brightness-110 transition-all"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
};

export default TableEmptyState;
