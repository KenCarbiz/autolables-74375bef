import { useEffect, useRef, useState } from "react";
import { MessageSquare, TriangleAlert, ChevronLeft, X } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// VerificationReportDock — the contextual help bubble for the
// Data-Verified Report. Deliberately NOT the conversion dock: on a
// trust report the actions are "review the recall / contact the
// dealer / go back", never "Reserve This Vehicle" while a material
// item still needs confirmation. Hidden in print + PDF.
// ──────────────────────────────────────────────────────────────

export interface VerificationReportDockProps {
  recallNeedsConfirmation: boolean;
  onAskRecall: () => void;
  onContact: () => void;
  onBack: () => void;
  onOpenChange?: (open: boolean) => void;
  onAction?: (action: string) => void;
}

const DISMISS_KEY = "al_verification_dock_dismissed";

export default function VerificationReportDock({
  recallNeedsConfirmation, onAskRecall, onContact, onBack, onOpenChange, onAction,
}: VerificationReportDockProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
  }, []);

  // Focus into the panel on open; return focus to the launcher on close.
  useEffect(() => {
    if (open) firstActionRef.current?.focus();
    else launcherRef.current?.focus();
  }, [open]);

  const setOpenTracked = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenTracked(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (dismissed) return null;

  const act = (action: string, fn: () => void) => { onAction?.(action); fn(); };
  const dismiss = () => {
    setOpenTracked(false);
    setDismissed(true);
    if (typeof window !== "undefined") sessionStorage.setItem(DISMISS_KEY, "1");
  };

  const heading = recallNeedsConfirmation ? "Recall status needs confirmation" : "Questions about this report?";

  return (
    <div className="fixed bottom-5 right-5 z-40 print:hidden" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div
        ref={panelRef}
        id="verification-report-dock-panel"
        role="dialog"
        aria-label="Report help"
        hidden={!open}
        className={`absolute bottom-[64px] right-0 w-[320px] rounded-2xl border border-[#E6E8EC] bg-white shadow-[0_20px_50px_rgba(15,23,42,0.18)] p-5 transition-all duration-150 ${open ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            {recallNeedsConfirmation && <TriangleAlert className="w-5 h-5 text-[#D97706] shrink-0 mt-0.5" aria-hidden="true" />}
            <p className="text-[15px] font-bold text-[#0F172A] leading-snug">{heading}</p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss report help" className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center shrink-0"><X className="w-4 h-4 text-[#64748B]" /></button>
        </div>
        <div className="mt-4 space-y-2">
          {recallNeedsConfirmation && (
            <button ref={firstActionRef} onClick={() => act("ask_recall", onAskRecall)} className="w-full min-h-[44px] rounded-xl bg-[#2563EB] hover:bg-[#1d4fd7] text-white text-[13.5px] font-bold inline-flex items-center justify-center gap-2 px-4"><TriangleAlert className="w-4 h-4" /> Ask about the recall</button>
          )}
          <button ref={recallNeedsConfirmation ? undefined : firstActionRef} onClick={() => act("contact", onContact)} className="w-full min-h-[44px] rounded-xl border border-[#E6E8EC] bg-white hover:border-[#2563EB] text-[13.5px] font-semibold text-[#0F172A] inline-flex items-center justify-center gap-2 px-4"><MessageSquare className="w-4 h-4 text-[#2563EB]" /> Contact the dealer</button>
          <button onClick={() => act("back", onBack)} className="w-full min-h-[44px] rounded-xl border border-transparent hover:bg-slate-50 text-[13.5px] font-semibold text-[#64748B] inline-flex items-center justify-center gap-2 px-4"><ChevronLeft className="w-4 h-4" /> Back to Vehicle Passport</button>
        </div>
      </div>

      <button
        ref={launcherRef}
        onClick={() => setOpenTracked(!open)}
        aria-expanded={open}
        aria-controls="verification-report-dock-panel"
        className="h-14 pl-5 pr-6 rounded-full bg-white border border-[#E6E8EC] shadow-[0_12px_30px_rgba(15,23,42,0.18)] inline-flex items-center gap-2.5 transition-transform hover:-translate-y-0.5"
      >
        {open ? <X className="w-5 h-5 text-[#64748B] shrink-0" aria-hidden="true" /> : <MessageSquare className="w-5 h-5 text-[#2563EB] shrink-0" aria-hidden="true" />}
        <span className="text-left leading-tight">
          <span className="block text-[13px] font-extrabold text-[#0F172A]">Questions about this report?</span>
          <span className="block text-[11px] text-[#64748B]">{recallNeedsConfirmation ? "Review recall · Contact dealer" : "Contact dealer · Back to passport"}</span>
        </span>
      </button>
    </div>
  );
}
