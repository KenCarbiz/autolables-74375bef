import { Fragment, useEffect, useRef, useState } from "react";
import { X, CheckCircle2, ArrowRight } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// InfoModal — the reusable centered modal for short educational
// explanations across AutoLabels (score meaning, verification
// process, warranty terms, data sources, …). One shell, one
// animation, one close behaviour; every popup is just content.
// Not a slide-out, not a page. Overlay + fade/scale, ESC / click-out
// / X close, focus trap, focus restored by the caller.
// ──────────────────────────────────────────────────────────────

export function InfoModal({
  open, onClose, icon: Icon, title, subtitle, footer, children,
}: {
  open: boolean;
  onClose: () => void;
  icon?: React.ElementType;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [enter, setEnter] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setRender(true); const r = requestAnimationFrame(() => setEnter(true)); return () => cancelAnimationFrame(r); }
    setEnter(false);
    const t = setTimeout(() => setRender(false), 200);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!render) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [render]);

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel) return;
      const f = panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!render) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-6" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div onClick={onClose} className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${enter ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full sm:w-[640px] sm:max-w-[92vw] max-h-[90vh] sm:max-h-[80vh] bg-white rounded-t-3xl sm:rounded-[20px] shadow-[0_30px_80px_rgba(0,0,0,0.30)] outline-none flex flex-col transition-all duration-200 ease-out ${enter ? "opacity-100 translate-y-0 sm:scale-100" : "opacity-0 translate-y-6 sm:translate-y-0 sm:scale-[0.96]"}`}
      >
        <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-[#64748B] hover:text-[#0F172A] transition-colors z-10"><X className="w-5 h-5" /></button>
        <div className="overflow-y-auto px-6 sm:px-8 pt-7 sm:pt-8 pb-2">
          <div className="flex items-start gap-3.5 pr-8">
            {Icon && <span className="w-11 h-11 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0"><Icon className="w-[22px] h-[22px] text-[#2563EB]" /></span>}
            <div className="min-w-0 pt-0.5"><h2 className="text-[19px] font-bold tracking-tight text-[#0F172A] leading-tight">{title}</h2>{subtitle && <p className="text-[13px] text-[#64748B] mt-0.5">{subtitle}</p>}</div>
          </div>
          <div className="mt-5 space-y-4 pb-4">{children}</div>
        </div>
        {footer && <div className="shrink-0 border-t border-[#E6E8EC] px-6 sm:px-8 py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

// ── Reusable content primitives ───────────────────────────────
export const Para = ({ children }: { children: React.ReactNode }) => <p className="text-[13.5px] leading-relaxed text-[#334155]">{children}</p>;

export const Bullets = ({ items }: { items: string[] }) => (
  <ul className="space-y-1.5">{items.map((it) => <li key={it} className="flex items-start gap-2 text-[13px] text-[#334155]"><span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] mt-[7px] shrink-0" />{it}</li>)}</ul>
);

export const Checklist = ({ items }: { items: string[] }) => (
  <ul className="space-y-1.5">{items.map((it) => <li key={it} className="flex items-start gap-2 text-[13px] text-[#0F172A]"><CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />{it}</li>)}</ul>
);

export const Callout = ({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" }) => (
  <div className={`rounded-xl border p-3.5 text-[13px] leading-relaxed ${tone === "green" ? "border-emerald-200 bg-emerald-50/60 text-[#0F172A]" : "border-blue-200 bg-blue-50/60 text-[#0F172A]"}`}>{children}</div>
);

export const Glossary = ({ items }: { items: { term: string; def: string }[] }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{items.map((g) => (
    <div key={g.term} className="rounded-xl border border-[#E6E8EC] p-3.5"><p className="text-[13px] font-bold text-[#0F172A]">{g.term}</p><p className="text-[12px] text-[#64748B] mt-0.5 leading-snug">{g.def}</p></div>
  ))}</div>
);

export const Flow = ({ steps }: { steps: string[] }) => (
  <div className="flex flex-wrap items-center gap-2">
    {steps.map((s, i) => (
      <Fragment key={s}>
        <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${i === steps.length - 1 ? "border-emerald-200 bg-emerald-50/70 text-[#16A34A]" : "border-[#E6E8EC] bg-white text-[#0F172A]"}`}>
          {i === steps.length - 1 && <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />}{s}
        </span>
        {i < steps.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />}
      </Fragment>
    ))}
  </div>
);

export const ScoreScale = () => {
  const bands = [
    { r: "90–100", l: "Excellent", c: "#16A34A" },
    { r: "80–89", l: "Very Good", c: "#22C55E" },
    { r: "70–79", l: "Good", c: "#F59E0B" },
    { r: "Below 70", l: "Fair", c: "#EF4444" },
  ];
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden">
        <span className="flex-1" style={{ background: "#EF4444" }} />
        <span className="flex-1" style={{ background: "#F59E0B" }} />
        <span className="flex-1" style={{ background: "#22C55E" }} />
        <span className="flex-1" style={{ background: "#16A34A" }} />
      </div>
      <div className="grid grid-cols-2 gap-2.5 mt-3">{bands.map((b) => (
        <div key={b.r} className="flex items-center gap-2.5 rounded-xl border border-[#E6E8EC] p-2.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.c }} />
          <div><p className="text-[13px] font-bold text-[#0F172A] leading-tight">{b.r}</p><p className="text-[11px] text-[#64748B]">{b.l}</p></div>
        </div>
      ))}</div>
    </div>
  );
};

export const SourceGrid = ({ items }: { items: { name: string; contributes: string }[] }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">{items.map((s) => (
    <div key={s.name} className="rounded-xl border border-[#E6E8EC] p-3">
      <p className="text-[12px] font-bold text-[#0F172A]">{s.name}</p>
      <p className="text-[11px] text-[#64748B] mt-0.5 leading-snug">{s.contributes}</p>
    </div>
  ))}</div>
);
