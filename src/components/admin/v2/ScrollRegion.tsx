import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// A horizontally scrolling region that shows it can scroll: edge fades on the
// side with hidden content, a keyboard stop (with a name) only while it
// actually overflows, and an optional element kept in view, such as the active tab.
export const ScrollRegion = ({
  children,
  label,
  className,
  innerClassName,
  revealSelector,
  tone = "surface",
}: {
  children: ReactNode;
  label: string;
  className?: string;
  innerClassName?: string;
  revealSelector?: string;
  /** The background the fades blend into. */
  tone?: "surface" | "workspace";
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    update();
    if (revealSelector) {
      const target = el.querySelector<HTMLElement>(revealSelector);
      if (target && el.scrollWidth > el.clientWidth) {
        const left = target.offsetLeft - el.offsetLeft;
        if (left + target.offsetWidth > el.clientWidth) el.scrollLeft = Math.max(0, left - 16);
        update();
      }
    }
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", update); ro?.disconnect(); };
  }, [revealSelector]);

  const scrollable = edges.left || edges.right;
  return (
    <div className={cn("relative", className)} data-scroll-edges={`${edges.left ? "left" : ""}${edges.right ? " right" : ""}`.trim() || undefined}>
      <div
        ref={ref}
        role={scrollable ? "region" : undefined}
        aria-label={scrollable ? `${label} (scrolls sideways)` : undefined}
        tabIndex={scrollable ? 0 : undefined}
        className={cn("overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-[inherit]", innerClassName)}
      >
        {children}
      </div>
      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r to-transparent", tone === "surface" ? "from-adm-surface" : "from-adm-workspace", " transition-opacity rounded-l-[inherit]", edges.left ? "opacity-100" : "opacity-0")} />
      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent", tone === "surface" ? "from-adm-surface via-adm-surface/70" : "from-adm-workspace via-adm-workspace/70", " transition-opacity rounded-r-[inherit]", edges.right ? "opacity-100" : "opacity-0")} />
    </div>
  );
};
