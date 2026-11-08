import { useId, useState, type ReactNode } from "react";
import { AdminIcon, AdminIconTile, SectionCard, useIsNarrow, type AdminIconName } from "@/components/admin/v3/editor";

/**
 * A section card that is always open from 768px up. On a phone it starts
 * collapsed behind a header that carries a count, so a long page stays short.
 */
export function AccordionCard({ id, icon, title, description, summary, children }: { id?: string; icon: AdminIconName; title: string; description?: ReactNode; summary: string; children: ReactNode }) {
  const narrow = useIsNarrow();
  const [open, setOpen] = useState(false);
  const auto = useId();
  const bodyId = `${id ?? auto}-body`;
  if (!narrow) return <SectionCard id={id} icon={icon} title={title} description={description}>{children}</SectionCard>;
  return (
    <section id={id} aria-labelledby={`${bodyId}-h`} className="rounded-xl bg-adm-surface border border-adm-divider shadow-[0_1px_2px_rgba(27,43,59,0.06)]">
      <h2 id={`${bodyId}-h`} className="text-[16px] leading-[24px] font-semibold text-adm-ink">
        <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 min-h-[64px] text-left rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary">
          <AdminIconTile name={icon} />
          <span className="min-w-0 flex-1">
            <span className="block">{title}</span>
            <span className="block text-[13px] leading-[18px] font-normal text-adm-muted">{summary}</span>
          </span>
          <AdminIcon name={open ? "chevron-down" : "chevron-right"} className="text-adm-muted flex-shrink-0" />
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="px-4 pb-5 pt-1 space-y-5 border-t border-adm-divider">
          {description && <p className="pt-3 text-[14px] leading-[20px] text-adm-muted">{description}</p>}
          {children}
        </div>
      )}
    </section>
  );
}
