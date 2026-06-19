import { ShieldCheck, BadgeCheck } from "lucide-react";
import { DealerProgram, requirementLabel } from "@/lib/dealerPrograms";

// Customer-packet rendering of the dealer's value-proposition programs, in the
// FTC shape: the value (headline), the offer (what's included), the customer
// benefit, and the disclosure (stipulations). Finance/other requirements are
// surfaced as a badge so the conditional nature is never hidden.
export default function DealerProgramsSection({ programs }: { programs?: DealerProgram[] | null }) {
  const list = (programs || []).filter((p) => p.enabled && (p.title.trim() || p.offer.trim()));
  if (list.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card shadow-premium p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <ShieldCheck className="w-4 h-4" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">Included with this vehicle</h2>
      </div>

      <div className="space-y-3">
        {list.map((p) => {
          const req = requirementLabel(p);
          return (
            <div key={p.id} className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14px] font-bold text-foreground leading-tight inline-flex items-center gap-1.5">
                  <BadgeCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  {p.title}
                </p>
                {req && (
                  <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                    {req}
                  </span>
                )}
              </div>
              {p.offer && <p className="text-[12px] text-slate-700 leading-relaxed mt-2">{p.offer}</p>}
              {p.benefit && (
                <p className="text-[12px] text-emerald-800 leading-relaxed mt-1.5 font-medium">{p.benefit}</p>
              )}
              {p.disclosure && (
                <p className="text-[10px] text-slate-500 leading-snug mt-2 pt-2 border-t border-emerald-100">{p.disclosure}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
