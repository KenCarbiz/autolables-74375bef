import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Review & Apply dialog: centered, max 900px, sticky action footer, Escape
// closes, focus is trapped while open and returns to the launcher after.

export const ReviewDialog = ({
  open,
  title,
  subtitle,
  onClose,
  footer,
  children,
  className,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  className?: string;
}) => {
  const panel = useRef<HTMLDivElement>(null);
  const launcher = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    launcher.current = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
      if (nodes.length === 0) return;
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstNode) { e.preventDefault(); lastNode.focus(); }
      else if (!e.shiftKey && document.activeElement === lastNode) { e.preventDefault(); firstNode.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const back = launcher.current as HTMLElement | null;
      if (back && typeof back.focus === "function") back.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#0B1526]/50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-review-dialog-title"
        className={cn("w-full max-w-[900px] max-h-[calc(100dvh-48px)] flex flex-col rounded-[8px] bg-adm-surface border border-adm-border shadow-xl text-adm-ink", className)}
      >
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-adm-border">
          <div className="min-w-0">
            <h2 id="admin-review-dialog-title" className="text-[20px] leading-[28px] font-bold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close review" className="w-9 h-9 rounded-md inline-flex items-center justify-center text-adm-muted hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </header>
        <div className="px-6 py-5 overflow-y-auto flex-1 min-h-0 space-y-5">{children}</div>
        <footer className="px-6 py-4 border-t border-adm-border bg-adm-surface flex items-center justify-between gap-3 flex-wrap">{footer}</footer>
      </div>
    </div>
  );
};
