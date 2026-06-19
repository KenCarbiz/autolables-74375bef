import { DealerProgram, requirementLabel } from "@/lib/dealerPrograms";

// Compact dealer-programs block for the printed window sticker. Keeps the FTC
// shape (value, offer, benefit, disclosure) in a dense, print-friendly form.
export default function DealerProgramsSticker({ programs }: { programs: DealerProgram[] }) {
  const list = programs.filter((p) => p.enabled && (p.title.trim() || p.offer.trim()));
  if (list.length === 0) return null;
  return (
    <div className="border-t border-foreground/15">
      <div className="px-3 py-1.5 bg-foreground/[0.03]">
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-foreground/60">Included with this vehicle</p>
      </div>
      <div className="divide-y divide-foreground/10">
        {list.map((p) => {
          const req = requirementLabel(p);
          return (
            <div key={p.id} className="px-3 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[10px] font-bold text-foreground leading-tight">{p.title}</p>
                {req && <span className="text-[7px] font-bold uppercase tracking-wide text-amber-700 whitespace-nowrap">{req}</span>}
              </div>
              {p.offer && <p className="text-[8px] text-foreground/70 leading-snug mt-0.5">{p.offer}</p>}
              {p.disclosure && <p className="text-[6.5px] text-foreground/45 leading-snug mt-0.5">{p.disclosure}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
