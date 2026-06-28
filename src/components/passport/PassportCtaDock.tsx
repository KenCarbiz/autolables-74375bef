import { useState } from "react";
import { ShieldCheck, RefreshCw, Phone, MessageSquare, Users, X, Star } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// PassportCtaDock — the global "Ready to take the next step?" CTA.
// A collapsed pill (bottom-right, desktop) that expands into the blue
// conversion card. Works at every desktop width (the old version only
// appeared at ≥2040px, where the right margin existed); hidden on mobile,
// where the Passport already shows a sticky bottom action bar. Mounts on
// the Passport V3 page and its destination pages from one component.
// ──────────────────────────────────────────────────────────────

interface Advisor { advisorName?: string; advisorTitle?: string; advisorPhoto?: string; advisorResponse?: string }

export interface PassportCtaDockProps {
  go: (section: string) => void;
  dealerPhone?: string;
  reviewRating?: number | null;
  advisor?: Advisor;
}

const MiniStars = ({ n }: { n: number }) => (
  <span className="inline-flex items-center gap-0.5">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="w-3 h-3 text-amber-300" fill={i < Math.round(n) ? "#FCD34D" : "none"} strokeWidth={1.5} />)}</span>
);

export default function PassportCtaDock({ go, dealerPhone, reviewRating, advisor }: PassportCtaDockProps) {
  const [open, setOpen] = useState(true);
  const adv = advisor || {};
  return (
    <div className="hidden lg:block fixed bottom-6 right-6 z-40" style={{ fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div className={`absolute bottom-[68px] right-0 w-[330px] transition-all duration-200 ${open ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-3 pointer-events-none"}`}>
        <div className="relative rounded-2xl p-6 text-white shadow-[0_20px_50px_rgba(37,99,235,0.35)]" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
          <button onClick={() => setOpen(false)} aria-label="Close" className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"><X className="w-4 h-4" /></button>
          <h2 className="text-[20px] font-extrabold leading-tight text-center px-5">Ready to take the next step?</h2>
          <p className="text-[12px] opacity-90 text-center mt-1">Choose the option that works best for you.</p>
          <button onClick={() => go("reserve")} className="mt-5 w-full rounded-xl bg-white text-[#2563EB] px-4 py-3.5 flex items-center justify-center gap-2 shadow-sm transition-transform hover:-translate-y-0.5"><ShieldCheck className="w-5 h-5" /><span className="text-left"><span className="block text-[15px] font-extrabold leading-tight">Reserve This Vehicle</span><span className="block text-[11px] font-medium text-[#2563EB]/70">Secure it today with a refundable deposit.</span></span></button>
          <button onClick={() => go("trade")} className="mt-3 w-full rounded-xl bg-white/10 border border-white/40 text-white px-4 py-3.5 flex items-center justify-center gap-2 transition-colors hover:bg-white/20"><RefreshCw className="w-5 h-5" /><span className="text-left"><span className="block text-[14px] font-extrabold leading-tight">Get a Trade Appraisal</span><span className="block text-[11px] font-medium opacity-80">Know your trade value in minutes.</span></span></button>
          <div className="mt-5 pt-4 border-t border-white/20">
            {adv.advisorName ? (
              <div className="flex items-center gap-3">
                {adv.advisorPhoto ? <img src={adv.advisorPhoto} alt={adv.advisorName} className="w-11 h-11 rounded-full object-cover ring-2 ring-white/40 shrink-0" /> : <span className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></span>}
                <div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight">{adv.advisorName}</p>{adv.advisorTitle && <p className="text-[11px] opacity-80 leading-tight">{adv.advisorTitle}</p>}{reviewRating != null && <div className="mt-0.5"><MiniStars n={reviewRating} /></div>}</div>
              </div>
            ) : (
              <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></span><div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-tight">Our specialists are here to help.</p><p className="text-[11px] opacity-80">No pressure. Real people.</p></div></div>
            )}
            {adv.advisorResponse && <p className="text-[11px] opacity-80 mt-2">{adv.advisorResponse}</p>}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {dealerPhone ? <a href={`tel:${dealerPhone}`} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1 hover:bg-white/25 transition-colors"><Phone className="w-3.5 h-3.5" /> {adv.advisorName ? `Call ${adv.advisorName.split(" ")[0]}` : "Call Sales"}</a> : <button onClick={() => go("contact")} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1"><Phone className="w-3.5 h-3.5" /> Call Sales</button>}
              <button onClick={() => go("contact")} className="h-9 rounded-lg bg-white/15 border border-white/40 text-[12px] font-bold inline-flex items-center justify-center gap-1 hover:bg-white/25 transition-colors"><MessageSquare className="w-3.5 h-3.5" /> Contact</button>
            </div>
          </div>
        </div>
      </div>

      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Ready to take the next step?" className="h-14 pl-5 pr-6 rounded-full text-white shadow-[0_12px_30px_rgba(37,99,235,0.4)] inline-flex items-center gap-2.5 transition-transform hover:-translate-y-0.5" style={{ background: "linear-gradient(160deg,#2563EB 0%,#1e50c8 100%)" }}>
        {open ? <X className="w-5 h-5 shrink-0" /> : <ShieldCheck className="w-5 h-5 shrink-0" />}
        <span className="text-left leading-tight"><span className="block text-[13px] font-extrabold">Ready to take the next step?</span><span className="block text-[11px] opacity-85">Reserve · Trade · Talk to us</span></span>
      </button>
    </div>
  );
}
