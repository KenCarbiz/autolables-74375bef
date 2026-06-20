import { validateStickerPacketMatch, type PacketContext, type MatchFinding } from "@/lib/stickerStudio/validateStickerPacketMatch";
import type { StickerData } from "@/lib/stickerStudio/templates";
import { ShieldCheck, AlertTriangle, XCircle, CheckCircle2 } from "lucide-react";

// Document-to-packet consistency review for an addendum sticker. Runs the pure
// validateStickerPacketMatch against the latest signing packet and surfaces the
// findings. Used in the Sticker Studio generator (and reusable in the Vehicle
// File). Blocking on `fail` is enforced by the caller (it disables approve/
// publish); this panel explains why.
const sevMeta: Record<MatchFinding["severity"], { tone: string; Icon: typeof AlertTriangle; label: string }> = {
  fail:    { tone: "text-rose-700 bg-rose-50 border-rose-200",     Icon: XCircle,       label: "Blocking" },
  warning: { tone: "text-amber-700 bg-amber-50 border-amber-200",  Icon: AlertTriangle, label: "Warning" },
  info:    { tone: "text-slate-600 bg-slate-50 border-slate-200",  Icon: ShieldCheck,   label: "Info" },
};

export default function StickerPacketReviewPanel({ sticker, ctx }: { sticker: StickerData; ctx: PacketContext }) {
  const result = validateStickerPacketMatch(sticker, ctx);
  const head =
    result.status === "blocked" ? { tone: "border-rose-200 bg-rose-50", Icon: XCircle, color: "text-rose-700", label: "Blocked — resolve before approval" }
    : result.status === "warn" ? { tone: "border-amber-200 bg-amber-50", Icon: AlertTriangle, color: "text-amber-700", label: "Needs review" }
    : { tone: "border-emerald-200 bg-emerald-50", Icon: CheckCircle2, color: "text-emerald-700", label: "Matches the packet" };
  const HeadIcon = head.Icon;

  return (
    <div className={`rounded-xl border p-3 ${head.tone}`}>
      <div className="flex items-center gap-2">
        <HeadIcon className={`w-4 h-4 ${head.color}`} />
        <p className={`text-sm font-bold ${head.color}`}>Sticker vs signing packet: {head.label}</p>
      </div>
      {result.findings.length === 0 ? (
        <p className="text-[11px] text-emerald-700 mt-1">The printed addendum matches the items, types, and pricing in the signing packet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {result.findings.map((f, i) => {
            const m = sevMeta[f.severity];
            const Icon = m.Icon;
            return (
              <li key={i} className={`rounded-lg border px-2.5 py-1.5 ${m.tone}`}>
                <div className="flex items-start gap-1.5">
                  <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold">{f.message}</p>
                    {(f.stickerValue || f.packetValue) && (
                      <p className="text-[10px] opacity-80">Sticker: {f.stickerValue || "—"} · Packet: {f.packetValue || "—"}</p>
                    )}
                    {f.fix && <p className="text-[10px] opacity-80">Fix: {f.fix}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
