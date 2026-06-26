import { useEffect, useRef, useState } from "react";
import { X, Info, CheckCircle2 } from "lucide-react";
import { fmt$ } from "@/lib/passportV2Data";

// ──────────────────────────────────────────────────────────────
// PassportSlideOver — the reusable right-side drawer that powers every
// Passport V3 Market Intelligence / detail panel. One shell, many
// content panels (see PassportPanel.tsx). Handles the mechanics:
// overlay, slide animation, body scroll lock, escape / click-out close,
// focus trap, ARIA dialog. Content is passed as children + footer.
// ──────────────────────────────────────────────────────────────

export const GREEN = "#16A34A";
export const BLUE = "#2563EB";
export const ORANGE = "#EA580C";
export const CARD = "rounded-2xl bg-white border border-[#E6E8EC]";

export function PassportSlideOver({
  open, onClose, title, subtitle, footer, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [render, setRender] = useState(open);
  const [enter, setEnter] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setRender(true);
      const r = requestAnimationFrame(() => setEnter(true));
      return () => cancelAnimationFrame(r);
    }
    setEnter(false);
    const t = setTimeout(() => setRender(false), 240);
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
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel) return;
      const f = panel.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'
      );
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
    <div className="fixed inset-0 z-[60]" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${enter ? "opacity-100" : "opacity-0"}`}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`absolute right-0 top-0 h-full w-full sm:w-[90vw] md:w-[600px] xl:w-[660px] 2xl:w-[680px] bg-[#F6F7F9] shadow-[0_0_60px_rgba(0,0,0,0.25)] outline-none flex flex-col transition-transform duration-200 ease-out will-change-transform ${enter ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="shrink-0 bg-white border-b border-[#E6E8EC] px-5 sm:px-6 py-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[19px] font-bold tracking-tight text-[#0F172A] leading-tight">{title}</h2>
            {subtitle && (
              <p className="text-[13px] text-[#64748B] mt-0.5 inline-flex items-center gap-1.5">
                {subtitle}<Info className="w-3.5 h-3.5 text-[#94A3B8]" />
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close panel"
            className="shrink-0 w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-[#64748B] hover:text-[#0F172A] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">{children}</div>

        {footer && (
          <div className="shrink-0 bg-white border-t border-[#E6E8EC] px-5 sm:px-6 py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  );
}

// ── Shared content primitives ─────────────────────────────────
type Tone = "green" | "blue" | "orange" | "neutral";
const TONE: Record<Tone, { text: string; bg: string; soft: string }> = {
  green: { text: "text-[#16A34A]", bg: "bg-emerald-100", soft: "border-emerald-200 bg-emerald-50/70" },
  blue: { text: "text-[#2563EB]", bg: "bg-blue-100", soft: "border-blue-200 bg-blue-50/70" },
  orange: { text: "text-[#EA580C]", bg: "bg-orange-100", soft: "border-orange-200 bg-orange-50/70" },
  neutral: { text: "text-[#0F172A]", bg: "bg-slate-100", soft: "border-[#E6E8EC] bg-white" },
};

export function Hero({ icon: Icon, tone = "neutral", label, value, note }: { icon: React.ElementType; tone?: Tone; label: string; value?: string; note?: string }) {
  const t = TONE[tone];
  return (
    <div className={`rounded-2xl border p-5 ${t.soft}`}>
      <div className="flex items-center gap-4">
        <span className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${t.bg}`}><Icon className={`w-7 h-7 ${t.text}`} /></span>
        <div className="min-w-0">
          <p className={`text-[18px] font-extrabold leading-tight ${t.text}`}>{label}</p>
          {value && <p className="text-[20px] font-extrabold text-[#0F172A] leading-tight">{value}</p>}
          {note && <p className="text-[12px] text-[#64748B] mt-0.5">{note}</p>}
        </div>
      </div>
    </div>
  );
}

export const Section = ({ title, sub, action, children }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <div>
    <div className="flex items-end justify-between gap-3 mb-2.5">
      <div>
        <h3 className="text-[15px] font-bold text-[#0F172A] leading-tight">{title}</h3>
        {sub && <p className="text-[12px] text-[#64748B] mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
);

export const Check = ({ children, tone = "green" }: { children: React.ReactNode; tone?: Tone }) => (
  <li className="flex items-start gap-2 text-[13px] text-[#0F172A]">
    <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${TONE[tone].text}`} />
    <span>{children}</span>
  </li>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className={`${CARD} p-4 text-[13px] text-[#64748B]`}>{children}</div>
);

export const StatRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-2 border-b border-[#F1F5F9] last:border-0">
    <span className="text-[13px] text-[#64748B]">{label}</span>
    <span className="text-[13px] font-semibold text-[#0F172A] text-right">{value}</span>
  </div>
);

// ── Charts ────────────────────────────────────────────────────
export function RangeBar({ low, avg, high, dealer }: { low: number; avg: number; high: number; dealer: number }) {
  const span = Math.max(1, high - low);
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - low) / span) * 100));
  const dealerPct = pct(dealer), avgPct = pct(avg);
  // Caption sits below the bar, anchored under the marker. Edge-aware so the
  // label/value never clips against the card edge when near the ends.
  const align = dealerPct <= 16 ? "items-start text-left" : dealerPct >= 84 ? "items-end text-right" : "items-center text-center";
  const tx = dealerPct <= 16 ? "none" : dealerPct >= 84 ? "translateX(-100%)" : "translateX(-50%)";
  return (
    <div className="pt-3 pb-11 relative">
      <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-amber-100 to-rose-200">
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[3px] h-4 rounded bg-[#0F172A]" style={{ left: `${avgPct}%` }} />
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-[#16A34A] ring-[3px] ring-white shadow" style={{ left: `${dealerPct}%` }} />
      </div>
      <div className={`absolute top-[22px] whitespace-nowrap flex flex-col ${align}`} style={{ left: `${dealerPct}%`, transform: tx }}>
        <span className="text-[11px] font-semibold text-[#16A34A]">Dealer Price</span>
        <span className="text-[13px] font-extrabold text-[#0F172A] leading-tight">{fmt$(dealer)}</span>
      </div>
    </div>
  );
}

export function TrendChart({ market = [], dealer = [], height = 150 }: { market?: number[]; dealer?: number[]; height?: number }) {
  const w = 560, h = height, pad = 8;
  const all = [...market, ...dealer].filter((n) => Number.isFinite(n));
  if (all.length < 2) return null;
  const min = Math.min(...all), max = Math.max(...all), range = Math.max(1, max - min);
  const path = (pts: number[]) =>
    pts.map((p, i) => `${(pad + (i / Math.max(1, pts.length - 1)) * (w - pad * 2)).toFixed(1)},${(pad + (1 - (p - min) / range) * (h - pad * 2)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} x2={w - pad} y1={pad + g * (h - pad * 2)} y2={pad + g * (h - pad * 2)} stroke="#E6E8EC" strokeWidth="1" strokeDasharray="3 4" />
      ))}
      {market.length >= 2 && <polyline points={path(market)} fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" />}
      {dealer.length >= 2 && <polyline points={path(dealer)} fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {dealer.length >= 2 && (() => { const p = path(dealer).split(" ").pop()!.split(","); return <circle cx={p[0]} cy={p[1]} r="3.5" fill={GREEN} />; })()}
    </svg>
  );
}

export function Ring({ pct, size = 96, color = GREEN }: { pct: number; size?: number; color?: string }) {
  const r = size / 2 - 8, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E6E8EC" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[22px] font-extrabold text-[#0F172A]">{pct}%</span>
    </div>
  );
}

export function Bars({ values, color = GREEN }: { values: number[]; color?: string }) {
  if (!values.length) return <div className="h-20 flex items-center"><div className="w-full border-t border-dashed border-[#E6E8EC]" /></div>;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-1 h-20">
      {values.map((v, i) => <span key={i} className="flex-1 rounded-sm" style={{ height: `${Math.max(6, (v / max) * 100)}%`, background: color, opacity: 0.5 + 0.5 * (v / max) }} />)}
    </div>
  );
}
